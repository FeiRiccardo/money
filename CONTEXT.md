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

**Retired label**:
The frozen name of a deleted Category, kept as plain text on the Transactions that had it. It is not a Category: it is never offered when entering a new Transaction, and it still counts in the monthly summary.
_Avoid_: Deleted category, archived category, orphan

**Recurring rule**:
A weekly, monthly or yearly schedule that creates Transactions automatically when the app opens. A Transaction it created is an ordinary Transaction with a ↻ mark.
_Avoid_: Subscription, standing order, scheduled transaction

**Balance**:
The all-time total of the user's money: the Opening balance plus all Income minus all Expenses.
_Avoid_: Total, net worth, account balance

**Opening balance**:
The amount the user already had before recording Transactions. It is a setting, may be negative, and is not part of the backup files.
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
