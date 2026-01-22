'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// Mock user data for development (when Clerk is not configured)
const mockUser = {
  fullName: 'HR Admin',
  firstName: 'HR',
  lastName: 'Admin',
  emailAddresses: [{ emailAddress: 'admin@jestais.com' }]
};

export default function ProfileViewPage() {
  const user = mockUser;

  return (
    <div className='flex w-full flex-col p-4'>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-4'>
            <Avatar className='h-20 w-20'>
              <AvatarFallback className='text-2xl'>
                {user.firstName?.[0]}
                {user.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className='text-xl font-semibold'>{user.fullName}</h2>
              <p className='text-muted-foreground'>
                {user.emailAddresses[0]?.emailAddress}
              </p>
            </div>
          </div>
          <div className='pt-4'>
            <p className='text-muted-foreground text-sm'>
              Profile settings are available when authentication is configured.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
