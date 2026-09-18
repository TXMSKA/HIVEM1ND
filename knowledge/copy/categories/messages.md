# Messages to people

Text addressed to someone rather than published on a page. Defaults for the whole category: Plain tone, result first, short block, dash policy none, emoji mirrored only (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Email

Applies when: a transactional email template, an outreach or follow-up email, a reply drafted for someone, "write an email to".

Options: second person, a conventional frame of one greeting line and one sign-off line where the relationship expects it, one ask per email. First person singular when an individual sends it.

Build: subject that states the point: *Invoice 2041 is due on September 30*; first body line the point; one ask; greeting and sign-off of one line each; the sender and signature as [messages.md](../messages.md#email) sets out.

Open: [messages.md, Email](../messages.md#email).

## Notifications

Applies when: a push notification, an in-app notification, an alert, a digest line, a chat bot message about an event.

Options: one sentence, the object and what happened to it, no marketing in transactional notices.

Build: *{Actor} {verb} {object}* or *{Object} {state}*: *Ana paid invoice 2041*, one event, opening onto the object.

Open: [messages.md, Notifications](../messages.md#notifications).

## Status reports and replies

Applies when: reporting work done, answering a question, a handoff note, a summary for someone who will decide something, and the replies an assistant or chatbot in the product sends to a person, including reply templates in server code.

Options: result first, one fact per line, five lines at most, one table and stop when there is more. A yes-or-no question gets yes or no.

Build: first line the result or the decision needed; then one fact per line, five at most, each broken, an assumption, unverified or an action needed.

Open: [messages.md, Status reports and replies](../messages.md#status-reports-and-replies).
