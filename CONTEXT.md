# Money Tracker

A simple personal money and expense tracker for one person with no accounting knowledge. The user records money going in and out and sorts it into categories.

## Language

**Transaction**:
A single recorded movement of money, either an Expense or an Income. It has one or more Categories or Retired labels.
_Avoid_: Entry, record, movement

**Expense**:
A Transaction where money leaves the user.
_Avoid_: Spending, outflow, cost

**Income**:
A Transaction where money comes to the user.
_Avoid_: Earning, inflow, revenue

**Category**:
A flat, user-editable label used to classify Transactions. Expense and Income each have their own separate list of Categories. A Transaction can carry several, and its full amount counts toward each. A Category's name is unique within its type, and a Retired label keeps its name reserved.
_Avoid_: Tag, bucket, label, sub-category

**Not-counted Category**:
A Category marked so its Transactions still change the Balance but are left out of the month's totals, the Category lines, the charts and the report totals; they are listed apart as "Not counted". For money moved rather than spent or earned, such as to or from savings. One Not-counted Category is enough to leave a whole Transaction out.
_Avoid_: Excluded category, transfer category, hidden category

**Retired label**:
The frozen name of a deleted Category, kept as plain text on the Transactions that had it. It is not a Category: it is never offered when entering a new Transaction, and it still counts in the monthly summary.
_Avoid_: Deleted category, archived category, orphan

**Recurring rule**:
A weekly, monthly or yearly schedule that creates Transactions automatically when the app opens. A Transaction it created is an ordinary Transaction with a ↻ mark.
_Avoid_: Subscription, standing order, scheduled transaction

**Account**:
A place the user keeps money: the main account, a savings account, the TFR. Every Transaction belongs to exactly one Account, and each Account has its own Opening balance and Balance. Categories are shared by all Accounts. There is always at least one; a new database starts with a "Main account".
_Avoid_: Wallet, bank, pot

**Transfer**:
Money moved from one Account to another. It is recorded as two linked Transactions (an Expense on the source, an Income on the destination, no Categories) that change each Account's Balance but are neither income nor an expense: they are left out of the month's totals, the Category lines, the charts and the report totals, and the all-Accounts Balance does not change. They are edited and deleted together.
_Avoid_: Move, internal payment

**Balance**:
The all-time total of an Account: its Opening balance plus all its Income minus all its Expenses. With "All accounts" chosen, the Balances of every Account added together.
_Avoid_: Total, net worth

**Opening balance**:
The amount an Account already held before its Transactions were recorded. It belongs to the Account, may be negative, and is part of the backup files (`accounts.csv`).
_Avoid_: Starting balance, initial amount

**Currency**:
The single unit of money all data is expressed in. Fixed to EUR in v1.
_Avoid_: Money unit

**Receipt photo**:
An image kept with one Transaction as proof of it (up to 5 per Transaction). It is shrunk when added and stays on the device.
_Avoid_: Attachment, receipt scan, image

**Full backup**:
One ZIP file with everything the CSV backup has plus the settings and the Receipt photos.
_Avoid_: Archive, export all

**Drive backup**:
The Full backup kept as one file in a hidden app folder of the user's own Google Drive, saved automatically while connected.
_Avoid_: Cloud sync, account, sync
