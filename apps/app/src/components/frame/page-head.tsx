import Head from 'expo-router/head';

type Props = {
  /** Browser tab title. The site name is added after it, except on the homepage. */
  title?: string;
  description?: string;
};

const SITE = 'Cramrade';
const DEFAULT_DESCRIPTION = 'A study plan built from your exam dates and your own notes.';

/** Title and description for the page. Rendered into the static HTML on web. */
export function PageHead({ title, description = DEFAULT_DESCRIPTION }: Props) {
  const fullTitle = title ? `${title}, ${SITE}` : SITE;
  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
    </Head>
  );
}
