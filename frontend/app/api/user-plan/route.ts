import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';

const PLAN_LIMITS = {
  free: 1,
  starter: 10,
  content_creator: 100,
};

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [userPlan] = await db.select({ plan: users.plan, storedSpaces: users.storedSpaces })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const limit = PLAN_LIMITS[userPlan.plan as keyof typeof PLAN_LIMITS];

  return NextResponse.json({
    plan: userPlan.plan,
    storedSpaces: userPlan.storedSpaces,
    limit,
  });
}
