import { PageSkeleton } from '../../../../../components/product/PageSkeleton';

/**
 * The project page's skeleton. It lives in this route group so it wraps only the root page:
 * a loading boundary sends the page with a 200 before it renders, so a missing release,
 * commit, or folder further down would answer 200 instead of 404.
 */
export default function Loading() {
  return <PageSkeleton rail />;
}
