import { stripe } from '../payments/stripe';
import { db } from './drizzle';
import { users, teams, teamMembers } from './schema';
import { hashPassword } from '@/lib/auth/session';

async function createStripeProducts() {
  console.log('Creating Stripe products and prices...');

  const freeProduct = await stripe.products.create({
    name: 'Free',
    description: 'Free tier with 1 stored space',
  });

  await stripe.prices.create({
    product: freeProduct.id,
    unit_amount: 0,
    currency: 'usd',
    recurring: { interval: 'month' },
  });

  const starterProduct = await stripe.products.create({
    name: 'Starter',
    description: 'Store up to 10 spaces',
  });

  await stripe.prices.create({
    product: starterProduct.id,
    unit_amount: 1000, // $10 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
  });

  const contentCreatorProduct = await stripe.products.create({
    name: 'Content Creator',
    description: 'Store up to 100 spaces',
  });

  await stripe.prices.create({
    product: contentCreatorProduct.id,
    unit_amount: 5000, // $50 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
  });

  console.log('Stripe products and prices created successfully.');
}

async function seed() {
  const email = 'test@test.com';
  const password = 'admin123';
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values([
      {
        email: email,
        passwordHash: passwordHash,
        role: "owner",
        plan: "free",
        storedSpaces: 0,
      },
    ])
    .returning();

  console.log('Initial user created.');

  const [team] = await db
    .insert(teams)
    .values({
      name: 'Test Team',
    })
    .returning();

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: 'owner',
  });

  await createStripeProducts();
}

seed()
  .catch((error) => {
    console.error('Seed process failed:', error);
    process.exit(1);
  })
  .finally(() => {
    console.log('Seed process finished. Exiting...');
    process.exit(0);
  });
