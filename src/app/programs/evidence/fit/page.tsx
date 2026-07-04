import { redirect } from "next/navigation";

/**
 * Program Fit moved into the Program Management **Pursue** tab as a sub-view
 * (`/programs?view=fit`) — choosing which competency to pursue from your evidence
 * is a Pursue decision. This legacy route redirects so old links/bookmarks keep
 * working.
 */
export default function ProgramFitRedirect(): never {
  redirect("/programs?view=fit");
}
