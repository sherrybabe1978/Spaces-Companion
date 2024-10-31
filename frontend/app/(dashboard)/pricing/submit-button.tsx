'use client';

import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ isPaidPlan, currentPlan }: { isPaidPlan: boolean; currentPlan?: string }) {
  const { pending } = useFormStatus();

  const buttonText = isPaidPlan && currentPlan !== 'free' ? 'Manage Subscription' : 'Get Started';

  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full bg-white hover:bg-gray-100 text-black border border-gray-200 rounded-full flex items-center justify-center"
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin mr-2 h-4 w-4" />
          Loading...
        </>
      ) : (
        <>
          {buttonText}
          <ArrowRight className="ml-2 h-4 w-4" />
        </>
      )}
    </Button>
  );
}
