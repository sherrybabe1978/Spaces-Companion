import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { spaces, users } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import path from 'path';
import fs from 'fs/promises';

const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');

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

    // Attempt to delete the file from local storage
    if (space.fileName) {
      const filePath = path.join(DOWNLOAD_DIR, space.fileName);
      try {
        await fs.unlink(filePath);
        console.log(`File ${space.fileName} deleted successfully from local storage.`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.error(`Error deleting file from local storage:`, error);
          throw error;
        } else {
          console.log(`File ${space.fileName} not found in local storage. Proceeding with database deletion.`);
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
