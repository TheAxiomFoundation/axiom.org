import { SUBSCRIBE_URL } from "./overview-content";

/**
 * Subscribe call to action — a single link out to the hosted Mailchimp form,
 * so the site carries no signup backend and never handles the address.
 *
 * The label matches the "Get updates" link in the axiom.org nav, which points
 * at the same list.
 */
export function SubscribeLink() {
  return (
    <a
      href={SUBSCRIBE_URL}
      className="btn-primary"
      target="_blank"
      rel="noopener noreferrer"
      data-testid="subscribe-link"
    >
      Get updates
    </a>
  );
}
