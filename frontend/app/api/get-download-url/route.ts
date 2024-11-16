import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import { getUser } from '@/lib/db/queries';

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
  const fileName = url.searchParams.get('fileName');

  if (!fileName) {
    return NextResponse.json({ error: 'File name is required' }, { status: 400 });
  }

  try {
    const bucket = storage.bucket(process.env.GCP_BUCKET_NAME || '');
    const file = bucket.file(fileName);

    const [fileContents] = await file.download();

    // Set the appropriate headers for the file download
    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${path.basename(fileName)}"`);
    headers.set('Content-Type', 'audio/mpeg');

    return new NextResponse(fileContents, {
      status: 200,
      headers: headers,
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
  }
}
