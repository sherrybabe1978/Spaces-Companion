// app/api/transcriptions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { spaces, transcriptions } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all transcriptions associated with the user's spaces
    const userTranscriptions = await db
      .select({
        id: transcriptions.id,
        spaceId: transcriptions.spaceId,
        status: transcriptions.status,
      })
      .from(transcriptions)
      .innerJoin(spaces, eq(transcriptions.spaceId, spaces.id))
      .where(eq(spaces.userId, user.id));

    return NextResponse.json({
      transcriptions: userTranscriptions.map(t => ({
        id: t.id,
        spaceId: t.spaceId,
        status: t.status,
      })),
    });
  } catch (error) {
    console.error('Error fetching transcriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcriptions' },
      { status: 500 }
    );
  }
}
