'use client';

import { useEffect, useRef } from 'react';

export function AutoSignIn({ action }: { action: () => Promise<void> }) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    ref.current?.requestSubmit();
  }, []);

  return <form ref={ref} action={action} />;
}
