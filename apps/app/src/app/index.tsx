import { Page } from '@/components/frame/page';
import { PageHead } from '@/components/frame/page-head';
import { Closing } from '@/components/home/closing';
import { Differences } from '@/components/home/differences';
import { Hero } from '@/components/home/hero';
import { HowItWorks } from '@/components/home/how-it-works';

/** The public homepage. */
export default function HomeScreen() {
  return (
    <Page>
      <PageHead />
      <Hero />
      <HowItWorks />
      <Differences />
      <Closing />
    </Page>
  );
}
