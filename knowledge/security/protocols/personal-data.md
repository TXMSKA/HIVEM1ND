name: personal-data
purpose: Prove every piece of personal data collected has a purpose, consent where one is needed, a known recipient and a way out, and that the notices say what the application does.
scope: forms, imports and scripts that collect personal data, consent boxes and banners, third-party scripts and SDKs, marketing mail, age screens, account deletion and export, and the privacy, cookie, terms and refund pages
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again after a field, a script, a processor or a mailing list is added
inputs: the source, the rendered site with its network panel and cookie list, a test account that owns data in every store, a test mailbox
stop: a notice states something the code does not do, such as no tracking while a tracker loads, which is reported before the pass continues
report: the field table, the consent records, the script table with its network evidence, the deletion and export result, the unsubscribe result and the list of notices

## Steps

1. Inventory what is collected, and why.
   Task: list every field in sign-up, checkout, profile, import and API bodies that holds data about a person, with its purpose, the store, the code that reads it and the retention. Remove a field nothing reads, and make optional what the feature works without.
   Time: 30 minutes. Repository.
   Result: a table of field, purpose, store, reader and retention, with zero fields lacking a reader. A field kept "just in case" is removed or recorded with a name against it. **Needs a person**: the retention period.

2. Record consent where it is needed, off by default.
   Task: find every box, toggle or banner choice that grants more than the service asked for. Confirm it is unticked, one per purpose, labelled with the purpose, apart from the terms, withdrawn as easily as given and stored with the time, the text version and the account. Where children may arrive, confirm an age screen runs before anything is stored.
   Time: 30 minutes. Running application, test account.
   Result: per consent, a capture of the unticked box, the stored record, and a withdrawal that stops the use; for the age screen, a transcript of an entry below the threshold refused or sent to a parent step. **Needs a person**: the threshold and the parent route.

3. Inventory third-party scripts and SDKs, and what loads before a choice.
   Task: list every third-party script, SDK, pixel, font host, embed and tag manager from the source and from the network panel of a cold load with cookies cleared. Record what each receives, who runs it and whether it sets an identifier. Hold back until consent what is not essential, and decline once.
   Time: 30 minutes. Running application, network panel.
   Result: a table of script, recipient, data sent, identifiers set and loaded before or after the choice; zero non-essential requests or cookies before consent and zero after a decline, read from the network panel and the cookie list. The same table is the source of the cookie notice. A package added for it also takes step 6 of [supply-chain](supply-chain.md).

4. Honour a deletion and an export request.
   Task: from a test account that owns data in every store, file the request through the product's own path, after re-authentication, and follow it through the rows, the files, the search index, the processors and the mailing list. Backups are left to expire on their rotation, never edited. Export the same person's data in a readable format.
   Time: 40 minutes. Running application, database access.
   Result: the row count of the account per store before and after, zero left except records a rule obliges the owner to keep, each with its reason; the processors' deletion calls logged, the backup rotation period recorded, and an export listing the fields of step 1. **Needs a person**: what must be kept, and the period for answering.

5. Let every recipient leave the marketing mail.
   Task: send one marketing and one transactional message to a test mailbox. The marketing one carries a visible unsubscribe link that works without signing in, the one-click `List-Unsubscribe` headers, the sender's identity and a postal address where the regime asks for one. The unsubscribe takes effect within the period the regime allows, and the address is not written to again. The transactional one carries no promotion.
   Time: 20 minutes. Test mailbox.
   Result: the raw headers of both messages, the unsubscribe link followed once with the record changed, and a second send to the address suppressed.

6. Write the notices from the tables and publish them.
   Task: list the notices the product needs: a privacy policy whenever data is collected, a cookie notice when non-essential storage exists, terms when accounts or purchases exist, a refund policy when money is taken, and the business details (legal name, address, contact address, registration or tax number where one applies). Each is linked from the footer and from the point of collection, carries a date, and agrees with steps 1 to 4: every processor, cookie, purpose and retention it names exists in the tables, and every one in the tables appears in it.
   Time: 30 minutes. Rendered site.
   Result: the list of notices with address, date and the links to each, a comparison of the tables against the notices with zero mismatches, and the text marked as supplied by the owner. **Needs a person**: the wording, the regime that applies and any review by counsel.
