# Messages to people

Text addressed to someone rather than published on a page. Defaults for the whole category: Plain tone, result first, short block, dash policy none, and no emoji unless the person used one first (see [options.md](../options.md#emoji)). Its protocols are in the [routing table](../INDEX.md#routing).

## Email

Applies when: a transactional email template, an outreach or follow-up email, a reply drafted for someone, "write an email to".

Build: subject that states the point: *Invoice 2041 is due on September 30*; first body line the point; one ask; greeting and sign-off of one line each; the sender and signature as [messages.md](../messages.md#email) sets out. A marketing email adds the sender's name and a visible unsubscribe link. The layout of an HTML email is the design module's [email layout](../../design/categories/pages-and-composition.md#email-layout).

Options: second person; the conventional frame where the relationship expects it; first person singular when an individual sends it.

Open: [messages.md, Email](../messages.md#email).

## Notifications

Applies when: a push notification, an in-app notification, an alert, a digest line, a chat bot message about an event.

Build: *{Actor} {verb} {object}* or *{Object} {state}*: *Ana paid invoice 2041*, one event, opening onto the object.

Options: one sentence; no person.

Open: [messages.md, Notifications](../messages.md#notifications).

## Status reports and replies

Applies when: reporting work done, answering a question, a handoff note, a summary for someone who will decide something, and the replies an assistant or chatbot in the product sends to a person, including reply templates in server code.

Build: first line the result or the decision needed; then one fact per line, five lines at most, each line tagged as broken, assumption, unverified or action needed.

Options: one fact per line by default; one table and stop when there is more.

Open: [messages.md, Status reports and replies](../messages.md#status-reports-and-replies).
