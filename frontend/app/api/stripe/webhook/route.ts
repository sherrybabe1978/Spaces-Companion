import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { users, teams } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err);
    return NextResponse.json(
      { error: 'Webhook signature verification failed.' },
      { status: 400 }
    );
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionChange(subscription);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return NextResponse.json({ received: true });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const subscriptionId = subscription.id;
  const status = subscription.status;

  // Find the team associated with this customer
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.stripeCustomerId, customerId))
    .limit(1);

  if (!team) {
    console.error('Team not found for Stripe customer:', customerId);
    return;
  }

  if (status === 'active' || status === 'trialing') {
    const plan = subscription.items.data[0]?.plan;
    const productId = plan?.product as string;

    // Fetch the product details to get the plan name
    const product = await stripe.products.retrieve(productId);
    let planName: 'free' | 'starter' | 'content_creator' = 'free';

    if (product.name === 'Starter') {
      planName = 'starter';
    } else if (product.name === 'Content Creator') {
      planName = 'content_creator';
    }

    // Update the team's subscription details
    await db
      .update(teams)
      .set({
        stripeSubscriptionId: subscriptionId,
        stripeProductId: productId,
        planName: product.name,
        subscriptionStatus: status,
      })
      .where(eq(teams.id, team.id));

    // Update all users in the team with the new plan
    await db
      .update(users)
      .set({
        plan: planName,
      })
      .where(eq(users.id, team.id));

  } else if (status === 'canceled' || status === 'unpaid') {
    // Revert to free plan
    await db
      .update(teams)
      .set({
        stripeSubscriptionId: null,
        stripeProductId: null,
        planName: 'Free',
        subscriptionStatus: status,
      })
      .where(eq(teams.id, team.id));

    // Update all users in the team to free plan
    await db
      .update(users)
      .set({
        plan: 'free',
      })
      .where(eq(users.id, team.id));
  }
}
