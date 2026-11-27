# 8. Send to family (MSG)

Release P: labelled placeholder. Release F: text messages between the person and the family. Legend: [README](README.md).

## Purpose

"Tell my son the medicine is finished." The person speaks; Kaabil reads it back, asks to confirm, and sends it. The family's typed reply is read aloud. The person does not need to type, find a contact or read a screen.

## Rules

| # | Rule |
|---|---|
| S1 | Nothing is sent until the person confirms the read-back with an explicit Yes. |
| S2 | Kaabil sends only to family members saved at setup. It never sends to a number or address spoken or typed by the person. |
| S3 | A reply is read aloud as plain text. Links in a reply are never read as links or opened. |
| S4 | Kaabil never invents or edits the text the person said. |
| S5 | The sentence "I told your son" is spoken only after delivery was recorded. |

## Requirements

### FR-MSG-01 Placeholder — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-MSG-01-1 | The send-to-family screen | it opens | it is labelled "placeholder", nothing is sent, and it says what the real feature will do |

### FR-MSG-02 Say, read back, confirm — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-MSG-02-1 | The person says "Tell my son the medicine is finished" | it is heard | Kaabil identifies the recipient from the saved family list and reads back "Message to your son: the medicine is finished. Send?" |
| AC-MSG-02-2 | The recipient is not in the list, or two family members match | heard | Kaabil asks which one, by name, with large buttons |
| AC-MSG-02-3 | The person says Yes | heard | the message is sent; Kaabil says it was sent only when the server confirms |
| AC-MSG-02-4 | The person says No, or the answer is unclear | heard | nothing is sent; Kaabil asks again, then shows buttons |
| AC-MSG-02-5 | The message is empty or longer than 500 characters | heard | Kaabil asks the person to say it again, shorter |

### FR-MSG-03 Delivery to the family — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-MSG-03-1 | A message is sent | the server stores it | one record per message; a retry never duplicates it |
| AC-MSG-03-2 | The family member has push allowed | the message arrives | a push and an in-app message appear within 3 seconds (target) |
| AC-MSG-03-3 | Delivery fails | the status is saved | the person is told "I could not send it. I will try again", and the family sees it on their next visit |

### FR-MSG-04 Reply read aloud — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-MSG-04-1 | A family member types a reply | it is sent | on the person's screen it appears large, and Kaabil reads it aloud in the person's language when the person is ready |
| AC-MSG-04-2 | The reply contains a link | it is shown | the link is shown as plain text, never opened or read as a link, and Kaabil says "your son sent a message" and reads the text |
| AC-MSG-04-3 | The reply is longer than 300 characters | it arrives | it is shown in full, and read in parts with a pause |
| AC-MSG-04-4 | The person is in a dose conversation | a reply arrives | it waits until the conversation has ended |

### FR-MSG-05 Quick replies for the person — F

**Description.** Large buttons with fixed replies ("OK", "Call me") so the person can answer without speaking. The wording is in the language files and reviewed like every other line.

| AC | Given | When | Then |
|---|---|---|---|
| AC-MSG-05-1 | A family message arrives | the person screen shows it | two or three fixed reply buttons appear |
| AC-MSG-05-2 | A quick reply is pressed | the person confirms | it is sent as in FR-MSG-02 |

### FR-MSG-06 Abuse and safety — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-MSG-06-1 | A family member sends messages without limit | the rate limit is reached | further sends are refused with a clear message to the sender |
| AC-MSG-06-2 | A removed family member | tries to send | the server refuses; nothing reaches the person |
| AC-MSG-06-3 | Message history | the family deletes a conversation | it is removed for both sides (chapter 10) |

## Verification

| Kind | How |
|---|---|
| Automated | Scenarios: send with Yes, send with No or silence, ambiguous recipient; API tests for idempotency, authorisation and limits |
| Manual | Two phones, one as the person and one as the family |
