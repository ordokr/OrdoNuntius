import type { Identity } from '@/lib/jmap/types';

export function createDemoIdentities(): Identity[] {
  return [
    {
      id: 'demo-identity-primary',
      name: 'Demo User',
      email: 'demo@example.com',
      textSignature: 'Best regards,\nDemo User\nOrdoNuntius Demo',
      htmlSignature: '<p>Best regards,<br><b>Demo User</b><br>OrdoNuntius Demo</p>',
      mayDelete: false,
    },
    {
      id: 'demo-identity-alias',
      name: 'Demo User',
      email: 'demo+newsletter@example.com',
      textSignature: '',
      htmlSignature: '',
      mayDelete: true,
    },
  ];
}
