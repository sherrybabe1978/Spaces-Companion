import { checkoutAction, customerPortalAction } from '@/lib/payments/actions';
import { Check } from 'lucide-react';
import { getStripePrices, getStripeProducts } from '@/lib/payments/stripe';
import { SubmitButton } from './submit-button';
import { getUser } from '@/lib/db/queries';
import { Button } from '@/components/ui/button';

// Prices are fresh for one hour max
export const revalidate = 3600;

export default async function PricingPage() {
  const [prices, products, user] = await Promise.all([
    getStripePrices(),
    getStripeProducts(),
    getUser(),
  ]);

  const freePlan = products.find((product) => product.name === 'Free');
  const starterPlan = products.find((product) => product.name === 'Starter');
  const contentCreatorPlan = products.find((product) => product.name === 'Content Creator');

  const freePrice = prices.find((price) => price.productId === freePlan?.id);
  const starterPrice = prices.find((price) => price.productId === starterPlan?.id);
  const contentCreatorPrice = prices.find((price) => price.productId === contentCreatorPlan?.id);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        <PricingCard
          name={freePlan?.name || 'Free'}
          price={freePrice?.unitAmount || 0}
          interval={freePrice?.interval || 'month'}
          features={[
            '1 Stored Space',
            'Basic Support',
          ]}
          priceId={freePrice?.id}
          currentPlan={user?.plan}
        />
        <PricingCard
          name={starterPlan?.name || 'Starter'}
          price={starterPrice?.unitAmount || 1000}
          interval={starterPrice?.interval || 'month'}
          features={[
            'Store up to 10 spaces',
            'Email Support',
          ]}
          priceId={starterPrice?.id}
          currentPlan={user?.plan}
        />
        <PricingCard
          name={contentCreatorPlan?.name || 'Content Creator'}
          price={contentCreatorPrice?.unitAmount || 5000}
          interval={contentCreatorPrice?.interval || 'month'}
          features={[
            'Store up to 100 spaces',
            'Priority Support',
            'Advanced Analytics',
          ]}
          priceId={contentCreatorPrice?.id}
          currentPlan={user?.plan}
        />
      </div>
    </main>
  );
}

function PricingCard({
  name,
  price,
  interval,
  features,
  priceId,
  currentPlan,
}: {
  name: string;
  price: number;
  interval: string;
  features: string[];
  priceId?: string;
  currentPlan?: string;
}) {
  const isCurrentPlan = (
    (name === 'Free' && currentPlan === 'free') ||
    (name === 'Starter' && currentPlan === 'starter') ||
    (name === 'Content Creator' && currentPlan === 'content_creator')
  );

  const isPaidPlan = name === 'Starter' || name === 'Content Creator';

  return (
    <div className="pt-6">
      <h2 className="text-2xl font-medium text-gray-900 mb-2">{name}</h2>
      <p className="text-4xl font-medium text-gray-900 mb-6">
        ${price / 100}{' '}
        <span className="text-xl font-normal text-gray-600">
          per {interval}
        </span>
      </p>
      <ul className="space-y-4 mb-8">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start">
            <Check className="h-5 w-5 text-purple-500 mr-2 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">{feature}</span>
          </li>
        ))}
      </ul>
      {isCurrentPlan ? (
        <Button disabled>Current Plan</Button>
      ) : (
        <form action={isPaidPlan && currentPlan !== 'free' ? customerPortalAction : checkoutAction}>
          <input type="hidden" name="priceId" value={priceId} />
          <SubmitButton isPaidPlan={isPaidPlan} currentPlan={currentPlan} />
        </form>
      )}
    </div>
  );
}
