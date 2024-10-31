import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { transcriptions, spaces } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';
import Groq from 'groq-sdk';
import path from 'path';
import fs from 'fs';
import os from 'os';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
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
  transcriptionId: number,
  previousSegmentEnd: number = 0
): Promise<ProcessedTranscriptionResponse> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `chunk_${chunkIndex}_${Date.now()}.mp3`);
  
  try {
    fs.writeFileSync(tempFilePath, chunk);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-large-v3-turbo",
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
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fileName = formData.get('fileName') as string;
    const spaceId = formData.get('spaceId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Create initial transcription record
    const [newTranscription] = await db.insert(transcriptions)
      .values({
        userId: user.id,
        fileName: fileName || file.name,
        status: 'processing',
        content: '',
        segments: '[]',
        spaceId: spaceId ? parseInt(spaceId) : null,
      })
      .returning();

    const buffer = Buffer.from(await file.arrayBuffer());
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
        newTranscription.id,
        lastSegmentEnd
      );
      
      completeText += (i > 0 ? ' ' : '') + text;
      allSegments = [...allSegments, ...segments];
      
      if (segments.length > 0) {
        lastSegmentEnd = segments[segments.length - 1].end;
      }
      
      progress = Math.round(((i + 1) / chunks.length) * 100);

      // Update progress in database
      await db.update(transcriptions)
        .set({
          status: `processing:${progress}`,
          content: completeText,
          segments: JSON.stringify(allSegments),
          updatedAt: new Date(),
        })
        .where(eq(transcriptions.id, newTranscription.id));

      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Final processing
    allSegments.sort((a, b) => a.start - b.start);

    // Clean up overlapping segments
    for (let i = 1; i < allSegments.length; i++) {
      if (allSegments[i].start < allSegments[i - 1].end) {
        const midPoint = (allSegments[i - 1].end + allSegments[i].start) / 2;
        allSegments[i - 1].end = midPoint;
        allSegments[i].start = midPoint;
      }
    }

    // Update final transcription
    const [updatedTranscription] = await db.update(transcriptions)
      .set({
        status: 'completed',
        content: completeText,
        segments: JSON.stringify(allSegments),
        updatedAt: new Date(),
      })
      .where(eq(transcriptions.id, newTranscription.id))
      .returning();

    // If this is associated with a space, update the space
    if (spaceId) {
      await db.update(spaces)
        .set({
          status: 'transcribed',
          updatedAt: new Date(),
        })
        .where(eq(spaces.id, parseInt(spaceId)));
    }

    return NextResponse.json({
      id: updatedTranscription.id,
      text: completeText,
      segments: allSegments,
      progress: 100,
      status: 'completed'
    });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to transcribe audio',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userTranscriptions = await db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.userId, user.id))
      .orderBy(transcriptions.createdAt);

    return NextResponse.json({ transcriptions: userTranscriptions });
  } catch (error) {
    console.error('Error fetching transcriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcriptions' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
