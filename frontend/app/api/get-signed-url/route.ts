// app/api/get-signed-url/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { spaces } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILENAME || ''),
});

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const spaceId = url.searchParams.get('spaceId');

  if (!spaceId) {
    return NextResponse.json({ error: 'Space ID is required' }, { status: 400 });
  }

  try {
    const [space] = await db.select()
      .from(spaces)
      .where(eq(spaces.id, parseInt(spaceId)))
      .limit(1);

    if (!space || !space.downloadUrl) {
      return NextResponse.json({ error: 'Space not found or no download URL available' }, { status: 404 });
    }

    const bucket = storage.bucket(process.env.GCP_BUCKET_NAME || '');
    const fileName = space.downloadUrl.split('/').slice(-3).join('/');
    const file = bucket.file(fileName);

    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return NextResponse.json({ url: signedUrl });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
  }
}
