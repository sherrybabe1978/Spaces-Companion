// app/api/transcribe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { transcriptions, spaces } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';
import Groq from 'groq-sdk';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Storage } from '@google-cloud/storage';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILENAME || ''),
});

const MAX_CHUNK_SIZE = 20 * 1024 * 1024; // 20MB in bytes

type TranscriptionSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

type GroqTranscriptionResponse = {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
};

type ProcessedTranscriptionResponse = {
  text: string;
  segments: TranscriptionSegment[];
};

async function processChunk(
  chunk: Buffer,
  chunkIndex: number,
  totalChunks: number,
  spaceId: number,
  previousSegmentEnd: number = 0
): Promise<ProcessedTranscriptionResponse> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `chunk_${chunkIndex}_${Date.now()}.mp3`);
  
  try {
    fs.writeFileSync(tempFilePath, chunk);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "distil-whisper-large-v3-en",
      response_format: "verbose_json",
    }) as GroqTranscriptionResponse;

    // Adjust segment timestamps based on the end of the previous chunk
    const adjustedSegments = transcription.segments.map((segment: TranscriptionSegment, index: number) => ({
      ...segment,
      id: chunkIndex * 1000 + index, // Ensure unique IDs across chunks
      start: segment.start + previousSegmentEnd,
      end: segment.end + previousSegmentEnd,
      seek: segment.seek + (chunkIndex * chunk.length),
    }));

    if (chunkIndex === 0) {
      await db.insert(transcriptions).values({
        spaceId: spaceId,
        content: transcription.text,
        segments: JSON.stringify(adjustedSegments),
        status: totalChunks === 1 ? 'completed' : 'in_progress',
      });
    } else {
      const [existingTranscription] = await db.select()
        .from(transcriptions)
        .where(eq(transcriptions.spaceId, spaceId))
        .limit(1);

      if (existingTranscription) {
        const existingSegments = JSON.parse(existingTranscription.segments || '[]');
        
        await db.update(transcriptions)
          .set({
            content: existingTranscription.content + ' ' + transcription.text,
            segments: JSON.stringify([...existingSegments, ...adjustedSegments]),
            status: chunkIndex === totalChunks - 1 ? 'completed' : 'in_progress',
            updatedAt: new Date(),
          })
          .where(eq(transcriptions.id, existingTranscription.id));
      }
    }

    return {
      text: transcription.text,
      segments: adjustedSegments,
    };
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { spaceId } = await request.json();

    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required' }, { status: 400 });
    }

    // Fetch the space details
    const [space] = await db.select()
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);

    if (!space || !space.downloadUrl) {
      return NextResponse.json({ error: 'Space not found or no download URL available' }, { status: 404 });
    }

    // Download the file from Google Cloud Storage
    const bucket = storage.bucket(process.env.GCP_BUCKET_NAME || '');
    const fileName = space.downloadUrl.split('/').slice(-3).join('/');
    const file = bucket.file(fileName);

    const [fileContents] = await file.download();
    const buffer = Buffer.from(fileContents);
    const totalSize = buffer.length;
    const chunks: Buffer[] = [];

    // Split buffer into chunks
    for (let i = 0; i < totalSize; i += MAX_CHUNK_SIZE) {
      chunks.push(buffer.slice(i, Math.min(i + MAX_CHUNK_SIZE, totalSize)));
    }

    let allSegments: TranscriptionSegment[] = [];
    let completeText = '';
    let progress = 0;
    let lastSegmentEnd = 0;

    for (let i = 0; i < chunks.length; i++) {
      const { text, segments } = await processChunk(
        chunks[i],
        i,
        chunks.length,
        space.id,
        lastSegmentEnd
      );
      
      completeText += (i > 0 ? ' ' : '') + text;
      allSegments = [...allSegments, ...segments];
      
      // Update lastSegmentEnd to the end time of the last segment in this chunk
      if (segments.length > 0) {
        lastSegmentEnd = segments[segments.length - 1].end;
      }
      
      progress = Math.round(((i + 1) / chunks.length) * 100);

      // Update progress in database
      const [existingTranscription] = await db.select()
        .from(transcriptions)
        .where(eq(transcriptions.spaceId, space.id))
        .limit(1);

      if (existingTranscription) {
        await db.update(transcriptions)
          .set({
            status: `processing:${progress}`,
            content: completeText,
            segments: JSON.stringify(allSegments),
          })
          .where(eq(transcriptions.id, existingTranscription.id));
      }

      // Send progress update to client
      if (i < chunks.length - 1) {
        // Only send intermediate updates
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to prevent flooding
      }
    }

    // Final processing
    allSegments.sort((a, b) => a.start - b.start);

    // Ensure no overlapping segments and clean up any small gaps
    for (let i = 1; i < allSegments.length; i++) {
      if (allSegments[i].start < allSegments[i - 1].end) {
        const midPoint = (allSegments[i - 1].end + allSegments[i].start) / 2;
        allSegments[i - 1].end = midPoint;
        allSegments[i].start = midPoint;
      }
    }

    // Update final status
    const [finalTranscription] = await db.select()
      .from(transcriptions)
      .where(eq(transcriptions.spaceId, space.id))
      .limit(1);

    if (finalTranscription) {
      await db.update(transcriptions)
        .set({
          status: 'completed',
          content: completeText,
          segments: JSON.stringify(allSegments),
        })
        .where(eq(transcriptions.id, finalTranscription.id));
    }

    return NextResponse.json({
      text: completeText,
      segments: allSegments,
      progress: 100,
    });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
