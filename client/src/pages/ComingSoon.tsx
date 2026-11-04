import Layout from '../components/Layout';
import type { Section } from '../nav';

/** Every section until it is built: the right title, icon and one line on what it will do. */
export default function ComingSoon({ section }: { section: Section }) {
  return (
    <Layout title={section.label} subtitle={section.tip}>
      <div className="empty-state">
        <i className={`ti ${section.icon}`} />
        {section.label} is not built yet.
      </div>
    </Layout>
  );
}
