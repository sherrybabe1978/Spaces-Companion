import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { spaces, users, teamMembers } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { eq, and } from 'drizzle-orm';

const API_URL = 'http://localhost:3000'; // Your external API URL

const PLAN_LIMITS = {
  free: 1,
  starter: 10,
  content_creator: 100,
};

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { spaceId } = await request.json();

  if (!spaceId) {
    return NextResponse.json({ error: 'Space ID is required' }, { status: 400 });
  }

  try {
    const userTeam = await db.select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id))
      .limit(1);

    if (!userTeam.length) {
      return NextResponse.json({ error: 'User is not part of a team' }, { status: 400 });
    }

    // Check user's plan and stored spaces
    const [userPlan] = await db.select({ plan: users.plan, storedSpaces: users.storedSpaces })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);



    const [newSpace] = await db.insert(spaces).values({
      spaceId,
      teamId: userTeam[0].teamId,
      userId: user.id,
      status: 'pending',
    }).returning();

    // Call the external API to start the download
    const response = await fetch(`${API_URL}/download-space`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ spaceId, spaceDbId: newSpace.id }),
    });

    if (!response.ok) {
      throw new Error('Failed to initiate space download');
    }

    // Increment the user's stored spaces count
    await db.update(users)
      .set({ storedSpaces: userPlan.storedSpaces + 1 })
      .where(eq(users.id, user.id));

    return NextResponse.json({ message: 'Download initiated', spaceId: newSpace.id });
  } catch (error) {
    console.error('Error initiating space download:', error);
    return NextResponse.json({ error: 'Failed to initiate space download' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userSpaces = await db.select()
    .from(spaces)
    .where(eq(spaces.userId, user.id));
  
  return NextResponse.json({ spaces: userSpaces });
}
