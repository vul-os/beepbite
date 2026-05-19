import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LookupCard } from './components/lookup-card';
import { IssueForm } from './components/issue-form';

/**
 * Gift Cards admin page — mounted at /gift-cards.
 *
 * Add to src/routes.jsx:
 *   { path: '/gift-cards', element: <GiftCardsPage /> }
 */
export default function GiftCardsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gift Cards</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Look up, reload, refund, or issue gift cards.
        </p>
      </div>

      <Tabs defaultValue="lookup">
        <TabsList>
          <TabsTrigger value="lookup">Lookup</TabsTrigger>
          <TabsTrigger value="issue">Issue</TabsTrigger>
        </TabsList>

        <TabsContent value="lookup" className="mt-4">
          <LookupCard />
        </TabsContent>

        <TabsContent value="issue" className="mt-4">
          <IssueForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
