# 9. Accounts, pairing and roles (AUTH)

Release P has no accounts: one browser holds everything. Release F adds a server, so that family and person can be on different phones. Legend: [README](README.md).

## Design decisions

| # | Decision | Why |
|---|---|---|
| A1 | **The person never has an account, a password, an OTP or a PIN.** The family member signs in. The person's phone is paired once. | Kaabil never asks an elder for an OTP or PIN, because that is exactly what scammers ask for. |
| A2 | Authentication uses a maintained library, not code we write ourselves. | Homemade authentication is the riskiest code a small team can write. |
| A3 | A person and their family form one **care group**. Every record belongs to exactly one care group, and every request is checked against it. | A mistake here would show one family's health data to another. |
| A4 | The server decides who may do what. The browser's checks are only for convenience. | Anything running on the person's phone can be changed by whoever holds it. |

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Owner** | Everything in the care group: invite and remove members, change medicines, consent, delete the group's data | Be removed by another member |
| **Family member** | See doses and alerts, acknowledge alerts, edit medicines and times, send messages | Delete the group, change roles |
| **Viewer** | See doses and alerts | Edit anything |
| **Person's device** | Send dose logs, alerts, messages and check-in answers for its own person; receive its person's plan and messages | Read the family list, other people's data, any family screen |

## Requirements

### FR-AUTH-01 Family sign-in — email and password built (backend); email code or link not built

**Description.** First method: email one-time code or magic link. A phone-number code needs a registered SMS sender in India and is decided later.

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-01-1 | A valid email | the family asks to sign in | a message with a code or link that works once and expires in 10 minutes is sent |
| AC-AUTH-01-2 | An expired or already used code | it is entered | it is refused with a plain message and no hint about the account |
| AC-AUTH-01-3 | Five wrong codes in a row | the sixth attempt | sign-in is slowed or locked for that email and address for a period, and the real owner is told |
| AC-AUTH-01-4 | An email that has no account | sign-in is requested | the answer is the same as for one that has (no account probing) |

### FR-AUTH-02 Sessions — cookie session and sign-out built (backend); the devices and sessions page is not built

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-02-1 | A session is created | its cookie is set | it is `HttpOnly`, `Secure` and `SameSite`, with an expiry (chapter 11) |
| AC-AUTH-02-2 | The family signs out | the next request | it is refused; the session is removed on the server, not only in the browser |
| AC-AUTH-02-3 | The family views "devices and sessions" | the page opens | each session and paired phone is listed with last-used time, and can be revoked |
| AC-AUTH-02-4 | A session is revoked | the next request from it | it is refused within one minute |

### FR-AUTH-03 Care group and roles — built (backend): roles owner and member; the viewer role is not built

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-03-1 | A new family signs in | setup finishes | a care group exists with the family member as owner |
| AC-AUTH-03-2 | A viewer calls an edit endpoint | the request arrives | 403, and nothing changes |
| AC-AUTH-03-3 | A member of group X requests a record of group Y by id | the request arrives | 404 (not 403, so existence is not revealed) |
| AC-AUTH-03-4 | The last owner | tries to leave | refused until another owner is named or the group is deleted |

### FR-AUTH-04 Invite a family member — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-04-1 | An owner invites an email with a role | the invite is created | a single-use link valid for 7 days is sent |
| AC-AUTH-04-2 | The link is used | the invitee signs in | they join with the invited role and the link stops working |
| AC-AUTH-04-3 | An owner cancels an invite | the link is used | it is refused |
| AC-AUTH-04-4 | A member is removed | their next request | refused; their sessions are revoked |

### FR-AUTH-05 Pair the person's phone — built (backend and test page)

**Description.** The family member creates a pairing code in the family app. The family member enters it on the person's phone (during setup, in the same room or while on a video call). The person is never asked to read out or type a code.

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-05-1 | An owner or family member asks to pair | a code is created | 8 digits, valid for 10 minutes, single use, tied to one care group |
| AC-AUTH-05-2 | The code is entered on a phone | it is correct and unused | the phone becomes the person's device and the code stops working |
| AC-AUTH-05-3 | Five wrong codes are tried on the care group | within 10 minutes | pairing for that group is paused for 15 minutes and the owner is told |
| AC-AUTH-05-4 | The person screen | in any state | nothing on it asks the person to say, read or type a code |
| AC-AUTH-05-5 | A second phone is paired | the code is used | the owner chooses whether it replaces the first or is added |

### FR-AUTH-06 Person's device credential — built (backend)

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-06-1 | A device is paired | it is issued a credential | a long random secret stored on the device, kept only as a hash on the server |
| AC-AUTH-06-2 | The credential is used | the server checks the scope | it can write only for its own person, and read only that person's plan |
| AC-AUTH-06-3 | The family revokes the device | its next request | refused; the phone shows a plain message and asks the family to pair again |
| AC-AUTH-06-4 | The person's phone is lost | the family revokes it | no data can be read from the server with it |

### FR-AUTH-07 Move from the prototype's local data — F

**Description.** The prototype keeps data in the browser. On first sign-in the family can bring the plan (medicines, times, consent) to the server. History is not uploaded unless the family chooses.

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-07-1 | Local data exists | the family signs in the first time | they are asked whether to bring the plan; nothing is uploaded without a yes |
| AC-AUTH-07-2 | They say no | setup continues | a clean care group is created and the local data stays only in the browser |

### FR-AUTH-08 The store is an adapter — F

**Description.** The app talks to storage through one interface. In P the implementation is `localStorage`; in F it is the API. The offline prototype keeps working without a server.

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-08-1 | No API is configured | the app loads | it works as in P |
| AC-AUTH-08-2 | The API is unreachable | a dose is logged | it is kept on the phone and sent later (FR-DOSE-10) |

### FR-AUTH-09 Leave and delete the account — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-AUTH-09-1 | A member leaves | they confirm | their access ends; the group's data stays |
| AC-AUTH-09-2 | An owner deletes the group | they confirm twice | chapter 10, FR-PRIV-04 applies |

## Verification

| Kind | How |
|---|---|
| Automated | API tests for each role against each endpoint; a test that every query is scoped by care group; code expiry and attempt limits |
| Security | Chapter 11's authorisation tests |
| Manual | Pairing two real phones; a revoked phone |
