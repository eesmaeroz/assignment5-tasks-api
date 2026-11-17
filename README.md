# Tasks API: Meryem Esma Eröz, 2200005798

SEN0415 Advanced Web Programming, Fall 2026, Assignment 5.

A Tasks API on Deno 2 with Hono, Drizzle and SQLite. Users register and log in, and every
user sees and changes only their own tasks.

## Run it

    cp .env.example .env
    deno task dev        # API on http://localhost:8000
    deno task test       # all tests (28)
    deno task check      # type-check
    deno task seed       # Bonus 5: demo users and tasks
    deno fmt --check     # formatting
    deno lint            # lint

## Try it in a browser (given, not graded)

`ui/` is a small React page that calls the API (log in, add, advance and delete tasks).
Start the API first, then in a second terminal:

    deno task ui:install   # once
    deno task ui:dev       # UI on http://localhost:5173

The only change I made in `ui/` is a `type` on every `<button>` (`type="submit"` for the
Add button in the form, `type="button"` for the others), because `deno lint` reported
`jsx-button-has-type` six times in `ui/src/App.tsx` and R1 asks for a clean lint.

## Design decisions (R8)

### Tables

| Table      | Columns                                                                          | Notes                                        |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| `users`    | `id`, `email` (unique), `password_hash`, `created_at`                            | given; the email is stored in lower case     |
| `sessions` | `token`, `user_id` → users, `expires_at`                                         | given; one row per login, valid for one hour |
| `tasks`    | `id`, `user_id` → users, `title`, `status`, `priority`, `due_date`, `created_at` | mine                                         |

- `status` is `todo`, `in-progress` or `done` (default `todo`), `priority` is `low`,
  `medium` or `high` (default `medium`). In `schema.ts` they are `{ enum: [...] }`, so
  TypeScript knows the values, and in `migrate()` they are `CHECK (... IN (...))`, so the
  database refuses a wrong value even from a hand-written INSERT. The two lists come from
  one place in the code (`STATUSES`, `PRIORITIES` in `schema.ts`), and the Zod schemas use
  the same arrays.
- **My own field: `dueDate`**, an optional deadline as `"YYYY-MM-DD"` (`null` = none). Zod
  checks it with `z.iso.date()`, which also refuses dates that do not exist, such as
  `2026-02-30`. I stored it as text and not as a number because a date without a time has
  no time zone problem, and text in this format still sorts correctly.
- `created_at` has a SQL default (`strftime('%s','now')`), so every row gets its own time.
  A JavaScript `Date.now()` in the schema would run only once.

### Routes

| Method and path                    | Token | Success                             | Failures      |
| ---------------------------------- | ----- | ----------------------------------- | ------------- |
| `GET /health`                      | no    | 200 `{ ok: true }`                  |               |
| `POST /auth/register`              | no    | 201 `{ id, email, createdAt }`      | 400, 409      |
| `POST /auth/login`                 | no    | 200 `{ token }`                     | 400, 401      |
| `GET /api/tasks?page&limit&status` | yes   | 200 `{ items, page, limit, total }` | 400, 401      |
| `POST /api/tasks`                  | yes   | 201 the new task                    | 400, 401      |
| `GET /api/tasks/:id`               | yes   | 200 the task                        | 401, 404      |
| `PUT /api/tasks/:id`               | yes   | 200 the updated task                | 400, 401, 404 |
| `DELETE /api/tasks/:id`            | yes   | 200 `{ ok: true }`                  | 401, 404      |

### Why it is built like this

- **One error shape.** Every failure is `{ "error": "...", "issues": [...] }`. `issues` is
  the list of Zod problems for a 400 (`path` and `message` only) and an empty array for
  all others, so a client can always read `body.error` and `body.issues` without checking
  first. The 401 from the middleware, `app.notFound` and `app.onError` all use the same
  `fail()` helper. `onError` logs the real error to the console and only says
  `internal error` to the client.
- **404, not 403, for another user's task.** Every task query has the owner in the `WHERE`
  (`own(id, userId)` = `id = ? AND user_id = ?`). A 403 would tell the caller that task 7
  exists and belongs to someone else; a 404 tells nothing, and the code is simpler because
  "not mine" and "does not exist" are the same empty result.
- **A non-numeric id (`/api/tasks/abc`) is 404**, for the same reason: no task can have
  that id. It is checked with Zod (`z.coerce.number().int().positive()`) before the query.
- **The same 401 message for a wrong email and a wrong password**, so the login cannot be
  used to find out which emails are registered.
- **Emails are stored in lower case**, so `ESMA@example.com` cannot register a second time
  next to `esma@example.com`.
- **PUT replaces the whole task.** The body has the same shape as POST (as the handout
  says), so a field that is left out gets its default again. For example the given UI's
  "advance" button sends only `title` and `status`, so the priority goes back to `medium`
  and the due date to `null` (My own log, entry 5). A partial update would be a `PATCH`
  route.
- **Pagination** is `ORDER BY id` (a stable order, so page 2 never repeats an item from
  page 1), `LIMIT limit OFFSET (page - 1) * limit`, and a second `count()` query with the
  same `WHERE` (owner and optional status) for `total`.
- **No string-built SQL.** All queries use Drizzle (`eq`, `and`, `count`), and the given
  session functions use `?` placeholders, so user input is always a parameter.
- **A missing or broken JSON body** becomes `undefined` (`c.req.json().catch(...)`) and
  Zod answers 400; it never reaches `onError`.

### Tests

28 tests (`deno task test`): 6 in `tests/auth_test.ts`, 12 in `tests/tasks_test.ts`, the
given health test, 6 in `tests/ratelimit_test.ts` for Bonus 15 and 3 in
`tests/seed_test.ts` for Bonus 5. They cover everything the handout lists: duplicate email
(409), wrong password (401), missing token (401), bad body (400), another user's task (404
for read, update **and** delete), invalid status (400) and pagination (page 2 holds the
right task), plus filtering, bad query values, the 101-character title, an impossible due
date, update and delete, and the 404 shape. `tests/helpers.ts` has `send()`, `login()` and
`makeTask()`.

The tests really catch mistakes: with the owner condition removed from `own()` on purpose,
"another user's task is 404 for read, update and delete" fails (at that time 18 passed and
1 failed of 19), and with it back all pass.

## API with curl (R8)

Real commands and real outputs, run against `deno task dev` on an empty database (bash;
`-w '\n%{http_code}'` prints the status code on the last line).

### GET /health

```
$ curl -s localhost:8000/health
{"ok":true}
```

### POST /auth/register

```
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"id":1,"email":"esma@example.com","createdAt":1794857501}

$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"error":"email already registered","issues":[]}

$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma","password":"123"}'
{"error":"validation failed","issues":[{"path":["email"],"message":"Invalid email address"},{"path":["password"],"message":"password must have at least 8 characters"}]}
```

### POST /auth/login

```
$ curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"yanlis-sifre"}'
{"error":"wrong email or password","issues":[]}

$ curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"token":"7b281096-e9e3-41c8-95fd-6b585000246d"}
```

For the task routes I saved the token in `TOKEN`, and registered and logged in a second
user (`mery@example.com`) whose token is in `MERY`.

### POST /api/tasks

```
$ curl -s -w '\n%{http_code}' -X POST localhost:8000/api/tasks -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Calculus homework","priority":"high","dueDate":"2026-11-20"}'
{"id":1,"userId":1,"title":"Calculus homework","status":"todo","priority":"high","dueDate":"2026-11-20","createdAt":1794857514}
201

$ curl -s -w '\n%{http_code}' -X POST localhost:8000/api/tasks -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Read Meteoroloji unit 5"}'
{"id":2,"userId":1,"title":"Read Meteoroloji unit 5","status":"todo","priority":"medium","dueDate":null,"createdAt":1794857514}
201

$ curl -s -w '\n%{http_code}' -X POST localhost:8000/api/tasks -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Unity racing game: lap timer","status":"in-progress","priority":"low"}'
{"id":3,"userId":1,"title":"Unity racing game: lap timer","status":"in-progress","priority":"low","dueDate":null,"createdAt":1794857514}
201

$ curl -s -w '\n%{http_code}' -X POST localhost:8000/api/tasks -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"","status":"finished"}'
{"error":"validation failed","issues":[{"path":["title"],"message":"Too small: expected string to have >=1 characters"},{"path":["status"],"message":"Invalid option: expected one of \"todo\"|\"in-progress\"|\"done\""}]}
400
```

### GET /api/tasks

```
$ curl -s -w '\n%{http_code}' localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN"
{"items":[{"id":1,"userId":1,"title":"Calculus homework","status":"todo","priority":"high","dueDate":"2026-11-20","createdAt":1794857514},{"id":2,"userId":1,"title":"Read Meteoroloji unit 5","status":"todo","priority":"medium","dueDate":null,"createdAt":1794857514},{"id":3,"userId":1,"title":"Unity racing game: lap timer","status":"in-progress","priority":"low","dueDate":null,"createdAt":1794857514}],"page":1,"limit":20,"total":3}
200

$ curl -s -w '\n%{http_code}' 'localhost:8000/api/tasks?page=2&limit=2' -H "Authorization: Bearer $TOKEN"
{"items":[{"id":3,"userId":1,"title":"Unity racing game: lap timer","status":"in-progress","priority":"low","dueDate":null,"createdAt":1794857514}],"page":2,"limit":2,"total":3}
200

$ curl -s -w '\n%{http_code}' 'localhost:8000/api/tasks?status=in-progress' -H "Authorization: Bearer $TOKEN"
{"items":[{"id":3,"userId":1,"title":"Unity racing game: lap timer","status":"in-progress","priority":"low","dueDate":null,"createdAt":1794857514}],"page":1,"limit":20,"total":1}
200

$ curl -s -w '\n%{http_code}' 'localhost:8000/api/tasks?limit=1000' -H "Authorization: Bearer $TOKEN"
{"error":"validation failed","issues":[{"path":["limit"],"message":"Too big: expected number to be <=100"}]}
400

$ curl -s -w '\n%{http_code}' localhost:8000/api/tasks
{"error":"unauthorized","issues":[]}
401
```

### GET /api/tasks/:id

```
$ curl -s -w '\n%{http_code}' localhost:8000/api/tasks/1 -H "Authorization: Bearer $TOKEN"
{"id":1,"userId":1,"title":"Calculus homework","status":"todo","priority":"high","dueDate":"2026-11-20","createdAt":1794857514}
200

$ curl -s -w '\n%{http_code}' localhost:8000/api/tasks/1 -H "Authorization: Bearer $MERY"
{"error":"task not found","issues":[]}
404
```

### PUT /api/tasks/:id

```
$ curl -s -w '\n%{http_code}' -X PUT localhost:8000/api/tasks/1 -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Calculus homework","status":"done","priority":"high","dueDate":"2026-11-20"}'
{"id":1,"userId":1,"title":"Calculus homework","status":"done","priority":"high","dueDate":"2026-11-20","createdAt":1794857514}
200

$ curl -s -w '\n%{http_code}' -X PUT localhost:8000/api/tasks/1 -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Calculus homework","dueDate":"2026-02-30"}'
{"error":"validation failed","issues":[{"path":["dueDate"],"message":"Invalid ISO date"}]}
400
```

### DELETE /api/tasks/:id

```
$ curl -s -w '\n%{http_code}' -X DELETE localhost:8000/api/tasks/2 -H "Authorization: Bearer $TOKEN"
{"ok":true}
200

$ curl -s -w '\n%{http_code}' -X DELETE localhost:8000/api/tasks/2 -H "Authorization: Bearer $TOKEN"
{"error":"task not found","issues":[]}
404
```

### An unknown route

```
$ curl -s -w '\n%{http_code}' localhost:8000/nothing-here
{"error":"not found","issues":[]}
404
```

## My own log (R8)

### 1. `curl` in PowerShell is not curl

With the server running, I typed the first command from this README into Windows
PowerShell:

```
PS C:\Users\eesma> curl -s localhost:8000/health

cmdlet Invoke-WebRequest at command pipeline position 1
Supply values for the following parameters:
Uri:
```

In Windows PowerShell `curl` is an alias for its own `Invoke-WebRequest` command, which
does not understand `-s` or the address in this form, so it asked for a `Uri`. I stopped
it with Ctrl+C and called the real program with `curl.exe`:

```
PS C:\Users\eesma> curl.exe -s localhost:8000/health
{"ok":true}
```

### 2. PowerShell removed the double quotes from my JSON body

The register command from this README, with `curl.exe`:

```
PS C:\Users\eesma> curl.exe -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"error":"validation failed","issues":[{"path":[],"message":"Invalid input: expected object, received undefined"}]}
```

Windows PowerShell 5.1 drops the inner `"` when it passes an argument to a native program,
so the server received `{email:esma@example.com,password:kediler123}`, which is not JSON.
My `readJson()` turns a body it cannot parse into `undefined`, and Zod answered 400 in the
normal error shape, so at least the server did not crash. Escaping every quote with `\`
worked:

```
PS C:\Users\eesma> curl.exe -s -X POST localhost:8000/auth/register -H "content-type: application/json" -d '{\"email\":\"esma@example.com\",\"password\":\"kediler123\"}'
{"id":1,"email":"esma@example.com","createdAt":1794857973}
```

### 3. The escaped quotes broke again when the title had a space

Logging in the same way worked, but creating a task did not:

```
PS C:\Users\eesma> curl.exe -s -X POST localhost:8000/api/tasks -H "content-type: application/json" -H "Authorization: Bearer $TOKEN" -d '{\"title\":\"Assignment 5 bitir\",\"priority\":\"high\",\"dueDate\":\"2026-11-30\"}'
{"error":"validation failed","issues":[{"path":[],"message":"Invalid input: expected object, received undefined"}]}
```

The difference from the register body was the space in `"Assignment 5 bitir"`. To check
this I sent a title without a space, and it worked:

```
PS C:\Users\eesma> curl.exe -s -X POST localhost:8000/api/tasks -H "content-type: application/json" -H "Authorization: Bearer $TOKEN" -d '{\"title\":\"A5bitir\"}'
{"id":1,"userId":1,"title":"A5bitir","status":"todo","priority":"medium","dueDate":null,"createdAt":1794858057}
```

So PowerShell 5.1 passes an argument that has both spaces and quotes in it wrongly (this
is fixed in PowerShell 7.3). The way around it that always works is to put the body in a
file and give curl the file:

```
PS C:\Users\eesma> Set-Content task.json '{"title":"Assignment 5 bitir","priority":"high","dueDate":"2026-11-30"}'
PS C:\Users\eesma> curl.exe -s -X POST localhost:8000/api/tasks -H "content-type: application/json" -H "Authorization: Bearer $TOKEN" --data-binary "@task.json"
{"id":2,"userId":1,"title":"Assignment 5 bitir","status":"todo","priority":"high","dueDate":"2026-11-30","createdAt":1794858069}
```

The curl examples above in this README are written for bash (for example Git Bash); on
Windows PowerShell use `curl.exe` and a body file.

### 4. My token still worked after I restarted the server

I stopped `deno task dev` with Ctrl+C and started it again, then sent a request with the
token from before the restart, without logging in again:

```
PS C:\Users\eesma> curl.exe -s localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN"
{"items":[{"id":1,"userId":1,"title":"A5bitir","status":"todo","priority":"medium","dueDate":null,"createdAt":1794858057},{"id":2,"userId":1,"title":"Assignment 5 bitir","status":"in-progress","priority":"medium","dueDate":null,"createdAt":1794858069}],"page":1,"limit":20,"total":2}
```

The session is not kept in the server's memory but as a row in the `sessions` table in
`tasks.db`, so a restart does not log anybody out. The token stops working only after its
`expires_at` (one hour), or if the row is deleted.

### 5. The given UI's "advance" button erased my priority and due date

I created "Assignment 5 bitir" with `priority: "high"` and `dueDate: "2026-11-30"` (entry
3). Then I started the UI (`deno task ui:install`, `deno task ui:dev`), logged in at
`http://127.0.0.1:5173` and clicked the task's `todo` button once. The status became
`in-progress` as expected, but the list (the output in entry 4) shows
`"priority":"medium"` and `"dueDate":null` for the same task.

The button sends `PUT /api/tasks/2` with only `title` and `status`. The PUT body has the
same shape as POST, so every field that is left out gets its default again: `priority`
becomes `medium` and `dueDate` becomes `null`. The API does what the handout describes
(PUT replaces the whole task), but for a user it looks like data was lost. A client must
send the whole task with PUT; a route that changes only the fields it receives would be a
`PATCH`.

### 6. My first CI run was red because of a missing newline

I created `.github/workflows/ci.yml` with Notepad, pasted the workflow and pushed. The
first run on GitHub Actions failed at the very first check:

```
Run deno fmt --check
from /home/runner/work/assignment5-tasks-api/assignment5-tasks-api/.github/workflows/ci.yml:
16 | -      - run: deno task test
   | \ No newline at end of file
16 | +      - run: deno task test
error: Found 1 not formatted file in 22 files
Error: Process completed with exit code 1.
```

Notepad saved the file without a newline after the last line, and `deno fmt` checks YAML
files too, not only TypeScript. `deno fmt .github\workflows\ci.yml` added the newline, and
the next push was green. The CI caught a mistake on the first try, in the CI file itself.

## Bonuses claimed

- Bonus 5: Seed data
- Bonus 15: Rate limit on login
- Bonus 18: Continuous integration
- Bonus 20: Git repository

## Bonus 5: Seed data

Bonus 5: Seed data

`deno task seed` (`scripts/seed.ts`) opens the same database as the app (`DATABASE_URL`,
or `file:./tasks.db`), creates the tables if needed, and adds two demo users with 11 and 9
tasks: different statuses, priorities and due dates, enough for two pages with `limit=10`.

**Log in as a demo user:** `demo.esma@example.com` or `demo.mery@example.com`, password
`demo-password-1` (in the given UI too). These are demo values only, not real passwords.

**Safe to run twice:**

- Users are inserted with `onConflictDoNothing({ target: users.email })`, so an email that
  is already there is skipped instead of failing on the `UNIQUE` constraint.
- A demo user gets tasks only if they have **no** tasks yet, so a second run adds nothing,
  and the tasks a demo user made by hand are never duplicated or deleted.
- A real user who registered before is not touched (only the two demo emails are used).
- With `APP_ENV=production` the script refuses to run, so demo accounts with a known
  password never reach a real database.

Real run on an empty database (bash):

```
$ deno task seed
Task seed deno run -A scripts/seed.ts
seed: file:./tasks.db -> added 2 users and 20 tasks
seed: log in as demo.esma@example.com or demo.mery@example.com, password demo-password-1

$ deno task seed
Task seed deno run -A scripts/seed.ts
seed: file:./tasks.db -> added 0 users and 0 tasks
seed: log in as demo.esma@example.com or demo.mery@example.com, password demo-password-1

$ APP_ENV=production deno task seed
Task seed deno run -A scripts/seed.ts
seed: refusing to run with APP_ENV=production
```

Tests (`tests/seed_test.ts`, 3 tests): the seed fills an empty database (2 users, 20
tasks) and a second run adds 0 and 0; a real user who registered first can still log in
and has no demo tasks; a demo user can log in and gets a first page of 5 out of 11 tasks.
`seed()` is exported and takes the database, so the tests run it on a temporary file
instead of the real `tasks.db`.

## Bonus 15: Rate limit on login

Bonus 15: Rate limit on login

After 5 failed logins for one email within one minute, `POST /auth/login` answers **429**
with a `Retry-After` header (seconds) until the minute is over, **even when the password
is right**.

- `src/ratelimit.ts` has a small `LoginLimiter` class: a `Map` from email to
  `{ failures, resetAt }` (a fixed window that starts with the first failure).
  `retryAfter(email)` is 0 or the seconds left, `recordFailure(email)` counts one failure,
  and `reset(email)` clears the counter after a successful login. A window that is over
  starts again from 0.
- In the login route the limit is checked **before** the password. If it were checked
  after, the 429 would only come for a wrong password, and a 200 behind the block would
  tell an attacker that a guess was right.
- The key is the email in lower case, the same as for login, so `ESMA@example.com` and
  `esma@example.com` share one counter.
- `createApp(db, limiter)` takes the limiter as a parameter (default: a new one), and the
  limiter takes the clock as a parameter (default `Date.now`). So every test has its own
  counters, and one test moves a fake clock forward instead of waiting a minute.

Real run (bash):

```
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"id":1,"email":"esma@example.com","createdAt":1794946427}

$ for i in 1 2 3 4 5; do curl -s -o /dev/null -w "attempt $i: %{http_code}\n" -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"yanlis-sifre"}'; done
attempt 1: 401
attempt 2: 401
attempt 3: 401
attempt 4: 401
attempt 5: 401

$ curl -si -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
HTTP/1.1 429 Too Many Requests
content-type: application/json
retry-after: 60
content-length: 63
date: Tue, 17 Nov 2026 20:13:47 GMT

{"error":"too many failed logins, try again later","issues":[]}
```

Tests (`tests/ratelimit_test.ts`, 6 tests): five failures and then 429 with `Retry-After`
even with the right password; the block is per email (another user can still log in);
upper and lower case count together; a successful login clears the counter; with a fake
clock the email is still blocked after 30 seconds (`Retry-After: 30`) and may log in after
the minute; and a unit test that an old window starts again from 0.

**What this does not protect against:**

- **Several servers.** The counters live in the memory of one process. With two servers
  behind a load balancer each has its own counters, so an attacker gets 5 tries per
  server. A shared store (Deno KV, Redis, or a table) would fix that.
- **A restart.** A restart empties the map, and the counting starts again.
- **Many emails.** It limits guesses **per email**, not per caller. Someone who tries one
  common password against thousands of emails ("password spraying") is never blocked. That
  needs a second limit per IP address (or per network).
- **Locking out a real user.** Anyone who knows your email can make 5 wrong logins every
  minute and keep you out. This is the price of limiting per email; longer windows make it
  worse, and that is why the block here lasts only one minute.
- **Memory.** An entry stays in the map until that email tries again after its window.
  Many different emails would make the map grow; a timer that deletes old entries would
  fix that.

## Bonus 18: Continuous integration

Bonus 18: Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request on GitHub Actions
(`ubuntu-latest`, Deno 2.x): `deno fmt --check`, `deno lint`, `deno task check` and
`deno task test`. The steps run in that order and the run stops at the first one that
fails, so the cheap checks come first.

- **Green run:**
  https://github.com/eesmaeroz/assignment5-tasks-api/actions/runs/44168745789 (run #2,
  "Fix CI: add the missing newline at the end of ci.yml")
- **Red run:** https://github.com/eesmaeroz/assignment5-tasks-api/actions/runs/44168308916
  (run #1, "Add Bonus 18: CI on GitHub Actions"), failed at `deno fmt --check` because
  `ci.yml` itself had no newline at the end. What happened and how I fixed it is in My own
  log, entry 6.

What I did: created the workflow file, pushed, opened the **Actions** tab of the
repository, read the failing step's log, fixed the file with `deno fmt`, and pushed again.

## Bonus 20: Git repository

Bonus 20: Git repository, https://github.com/eesmaeroz/assignment5-tasks-api

- `.gitignore` leaves out `.env`, `*.db` (and `*.db-journal`), `node_modules`, `uploads/`
  and `dist`, so no secret and no database file is in the repository.
- It runs on a machine that has only Deno:

  ```
  git clone https://github.com/eesmaeroz/assignment5-tasks-api.git
  cd assignment5-tasks-api
  deno task test
  ```

  (`cp .env.example .env` is only needed for `deno task dev`; the tests make their own
  temporary database.)
- The history follows the steps of the handout: the starter (step 1), the tasks table
  (step 2), the auth middleware (step 5), the routes with validation and pagination (steps
  3 to 8), the tests (step 9), the README (step 10), then this section.
