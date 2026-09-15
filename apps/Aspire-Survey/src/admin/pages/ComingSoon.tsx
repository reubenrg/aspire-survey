import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../ui';

/**
 * A named placeholder, not a blank route.
 *
 * These sections are in the navigation because the information architecture is
 * settled, but the screens are not built. Saying so plainly is better than a
 * dead link or a screen that looks broken: someone clicking Analytics should
 * learn where that work currently lives, not wonder whether it failed to load.
 */
export default function ComingSoon({
  title, summary, whereForNow, to,
}: { title: string; summary: string; whereForNow?: string; to?: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={summary} />
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">Not built yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {whereForNow ?? 'This section is planned but not implemented.'}
        </p>
        {to && (
          <div className="mt-4 flex justify-center">
            <Link to={to}><Button variant="outline" size="sm">Go there</Button></Link>
          </div>
        )}
      </div>
    </>
  );
}
