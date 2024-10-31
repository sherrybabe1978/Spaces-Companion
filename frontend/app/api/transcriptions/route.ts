// app/api/transcriptions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { transcriptions } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';

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
