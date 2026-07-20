import React from 'react';
import { useLocation } from 'react-router-dom';
import DocsLayout, { usePrevNext } from '@/components/layout/docs-layout';
import {
  PageHeader,
  Section,
  Steps,
  Step,
  Screenshot,
  Callout,
  PrevNext,
  KeyValueList,
} from '@/components/docs/docs-primitives';

const MenuManagement = () => {
  const { pathname } = useLocation();
  const { prev, next } = usePrevNext(pathname);

  return (
    <DocsLayout title="Menu management" description="Add items, modifiers and categories. Sync everywhere.">
      <PageHeader
        eyebrow="Restaurant Operations"
        title="Menu management"
        description="Build and maintain a single menu that powers your POS, your WhatsApp ordering and any QR menus you print."
        readTime="7 min"
        lastUpdated="2026-04-22"
      />

      <KeyValueList
        items={[
          { label: 'Where', value: 'Top nav → Menu' },
          { label: 'Permissions', value: 'Manager and above' },
          { label: 'Sync', value: 'Changes appear instantly across POS and WhatsApp' },
        ]}
      />

      <Section id="overview" title="Menu structure">
        <p>
          A BeepBite menu is made up of <strong>categories</strong> (e.g. Burgers, Drinks), <strong>items</strong>{' '}
          (e.g. Spicy Chicken Burger) and <strong>modifiers</strong> (e.g. extra cheese, sauce choice).
        </p>
        <Screenshot
          variant="browser"
          url="app.beepbite.io/menu"
          alt="The menu editor with categories on the left, items in the middle and the item editor on the right."
          caption="Menu editor — drop the real screenshot in /public/docs/menu-editor.png"
        />
      </Section>

      <Section id="add-items" kicker="How-to" title="Add an item">
        <Steps>
          <Step title="Open the menu">
            Tap <strong>Menu</strong> in the top nav, then <strong>+ New item</strong>.
          </Step>
          <Step title="Fill in the basics">
            Name, price, description and (optionally) a photo. Photos boost WhatsApp conversion noticeably.
          </Step>
          <Step title="Pick a category">
            Pick an existing category or create one on the fly. Category order on the POS matches the order you set
            here.
          </Step>
          <Step title="Save and preview">
            Hit <strong>Save</strong>. The item appears on the POS immediately and is selectable on WhatsApp.
          </Step>
        </Steps>
      </Section>

      <Section id="modifiers" kicker="Customisation" title="Modifiers and modifier groups">
        <p>
          Modifiers let customers customise an item — extra cheese, sauce choice, wing flavour. Group related modifiers
          into <strong>modifier groups</strong> with rules like "pick exactly one" or "pick up to three."
        </p>
        <Screenshot
          variant="plain"
          alt="A modifier group called 'Sauce' with three options: Mild, Medium, Spicy. Rule set to 'choose exactly one.'"
          caption="Modifier groups support required, optional and multi-select rules"
          ratio="16/9"
        />
        <Callout tone="tip" title="Reuse modifier groups">
          Create a single "Sauce" group and attach it to every burger. Edit the sauces in one place — they update
          everywhere.
        </Callout>
      </Section>

      <Section id="availability" kicker="Inventory" title="Availability and 86-ing items">
        <p>
          When you run out of an item, mark it <strong>Out of stock</strong> from the POS. It's hidden from WhatsApp
          immediately and greyed out at the counter. When you restock, toggle it back on — no menu re-publish needed.
        </p>
        <KeyValueList
          items={[
            { label: 'In stock', value: 'Visible everywhere, orderable.' },
            { label: 'Out of stock', value: 'Greyed out at the counter, hidden on WhatsApp.' },
            { label: 'Hidden', value: 'Not visible anywhere. Useful for seasonal items.' },
          ]}
        />
      </Section>

      <PrevNext prev={prev} next={next} />
    </DocsLayout>
  );
};

export default MenuManagement;
