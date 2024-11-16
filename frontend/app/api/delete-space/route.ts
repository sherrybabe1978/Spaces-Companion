import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { spaces, users } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { Storage } from '@google-cloud/storage';
import path from 'path';

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: path.join(process.cwd(), process.env.GCP_KEY_FILENAME || ''),
});

export async function DELETE(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Space ID is required' }, { status: 400 });
  }

  try {
    console.log(`Attempting to delete space with ID: ${id}`);

    // Get the space details
    const [space] = await db.select().from(spaces)
      .where(and(
        eq(spaces.id, parseInt(id)),
        eq(spaces.userId, user.id)
      ))
      .limit(1);

    if (!space) {
      console.log(`Space with ID ${id} not found in database or doesn't belong to the user`);
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    console.log(`Space found:`, space);

    // Attempt to delete the file from Google Cloud Storage
    if (space.downloadUrl) {
      const fileName = space.downloadUrl.split('/').slice(-3).join('/');
      const bucket = storage.bucket(process.env.GCP_BUCKET_NAME || '');
      try {
        await bucket.file(fileName).delete();
        console.log(`File ${fileName} deleted successfully from GCS.`);
      } catch (error: any) {
        if (error.code === 404) {
          console.log(`File ${fileName} not found in GCS. Proceeding with database deletion.`);
        } else {
          console.error(`Error deleting file from GCS:`, error);
          throw error; // Re-throw if it's not a 404 error
        }
      }
    }

    // Delete the space from the database
    const deleteResult = await db.delete(spaces)
      .where(and(
        eq(spaces.id, parseInt(id)),
        eq(spaces.userId, user.id)
      ))
      .returning();
    console.log(`Database deletion result:`, deleteResult);

    if (deleteResult.length === 0) {
      console.log(`No rows were deleted from the database for space ID ${id}`);
      return NextResponse.json({ error: 'Failed to delete space from database' }, { status: 500 });
    }

    // Update the user's stored spaces count
    await db.update(users)
      .set({ storedSpaces: sql`stored_spaces - 1` })
      .where(eq(users.id, user.id));

    return NextResponse.json({ message: 'Space deleted successfully' });
  } catch (error) {
    console.error('Error deleting space:', error);
    return NextResponse.json({ error: 'Failed to delete space' }, { status: 500 });
  }
}
