# Tasks API: Meryem Esma Eröz, 2200005798

SEN0415 Advanced Web Programming, Fall 2026, Assignment 5.

A Tasks API on Deno 2 with Hono, Drizzle and SQLite. Users register and log in, and every
user sees and changes only their own tasks.

## Run it

    cp .env.example .env
    deno task dev        # API on http://localhost:8000, docs on http://localhost:8000/docs
    deno task test       # all tests (102)
    deno task check      # type-check
    deno task seed       # Bonus 5: demo users and tasks
    deno task db:generate  # Bonus 1: a new migration in drizzle/ after a change in schema.ts
    deno task start:test # Bonus 11: start with .env.test (port 8001)
    deno task n1         # Bonus 3: count the queries of the N+1 and the GROUP BY summary
    deno task explain    # Bonus 4: the query plan and time before and after the index
    deno task watch <email> <password>   # Bonus 13: print the live updates of a user
    deno fmt --check     # formatting
    deno lint            # lint

## Try it in a browser (given, not graded)

`ui/` is a small React page that calls the API (log in, add, advance and delete tasks).
Start the API first, then in a second terminal:

    deno task ui:install   # once
    deno task ui:dev       # UI on http://localhost:5173

For Bonus 13 the UI also listens on the WebSocket (see that section). Apart from that, the
only change I made in `ui/` is a `type` on every `<button>` (`type="submit"` for the Add
button in the form, `type="button"` for the others), because `deno lint` reported
`jsx-button-has-type` six times in `ui/src/App.tsx` and R1 asks for a clean lint.

## Design decisions (R8)

### Tables

| Table      | Columns                                                                                                                 | Notes                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `users`    | `id`, `email` (unique), `password_hash`, `created_at`                                                                   | given; the email is stored in lower case                                  |
| `sessions` | (removed in Bonus 7)                                                                                                    | was given: one row per login; a signed token (JWT) replaced it            |
| `tasks`    | `id`, `user_id` → users, `title`, `status`, `priority`, `due_date`, `created_at`, `deleted_at`, `done_at`, `attachment` | mine (`deleted_at`: Bonus 2, `done_at`: Bonus 14, `attachment`: Bonus 12) |

- `status` is `todo`, `in-progress` or `done` (default `todo`), `priority` is `low`,
  `medium` or `high` (default `medium`). In `schema.ts` they are `{ enum: [...] }`, so
  TypeScript knows the values, and in the database they are `CHECK (... IN (...))` (since
  Bonus 1 as `check(...)` in `schema.ts`, in the first migration), so the database refuses
  a wrong value even from a hand-written INSERT. The two lists come from one place in the
  code (`STATUSES`, `PRIORITIES` in `schema.ts`), and the Zod schemas use the same arrays.
- **My own field: `dueDate`**, an optional deadline as `"YYYY-MM-DD"` (`null` = none). Zod
  checks it with `z.iso.date()`, which also refuses dates that do not exist, such as
  `2026-02-30`. I stored it as text and not as a number because a date without a time has
  no time zone problem, and text in this format still sorts correctly.
- `created_at` has a SQL default (`strftime('%s','now')`), so every row gets its own time.
  A JavaScript `Date.now()` in the schema would run only once.

### Routes

| Method and path                         | Token      | Success                                  | Failures      |
| --------------------------------------- | ---------- | ---------------------------------------- | ------------- |
| `GET /health`                           | no         | 200 `{ ok: true }`                       |               |
| `POST /auth/register`                   | no         | 201 `{ id, email, createdAt }`           | 400, 409      |
| `POST /auth/login`                      | no         | 200 `{ token }`                          | 400, 401      |
| `GET /api/tasks?page&limit&status`      | yes        | 200 `{ items, page, limit, total }`      | 400, 401      |
| `POST /api/tasks`                       | yes        | 201 the new task                         | 400, 401      |
| `GET /api/tasks/:id`                    | yes        | 200 the task                             | 401, 404      |
| `PUT /api/tasks/:id`                    | yes        | 200 the updated task                     | 400, 401, 404 |
| `DELETE /api/tasks/:id`                 | yes        | 200 `{ ok: true }`                       | 401, 404      |
| `POST /api/tasks/:id/restore` (Bonus 2) | yes        | 200 the restored task                    | 401, 404      |
| `GET /api/me/summary` (Bonus 3)         | yes        | 200 `{ todo, in-progress, done, total }` | 401           |
| `GET /api/admin/users` (Bonus 9)        | yes, admin | 200 `{ items: [...] }`                   | 401, 403      |

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
- **No string-built SQL.** All queries use Drizzle (`eq`, `and`, `count`), and every raw
  SQL string uses `?` placeholders, so user input is always a parameter.
- **A missing or broken JSON body** is 400 in the same error shape. At first this was
  `c.req.json().catch(() => undefined)`, which Zod then refused; since Bonus 8 the
  validator of `@hono/zod-openapi` checks the body, and `onError` turns its exception into
  our 400 (and 415 for a body that is not `application/json`).

### Tests

102 tests (`deno task test`): 6 in `tests/auth_test.ts`, 12 in `tests/tasks_test.ts`, the
given health test, and for the bonuses: 5 in `tests/migrations_test.ts` (Bonus 1), 5 in
`tests/softdelete_test.ts` (Bonus 2), 4 in `tests/summary_test.ts` (Bonus 3), 6 in
`tests/pool_test.ts` (Bonus 6), 2 in `tests/index_test.ts` (Bonus 4), 7 in
`tests/jwt_test.ts` (Bonus 7), 6 in `tests/openapi_test.ts` (Bonus 8), 3 in
`tests/seed_test.ts` (Bonus 5), 6 in `tests/roles_test.ts` (Bonus 9), 3 in
`tests/logging_test.ts` (Bonus 10), 8 in `tests/config_test.ts` (Bonus 11, one for Bonus
14 and the defaults of 6, 12 and 16), 8 in `tests/upload_test.ts` (Bonus 12), 4 in
`tests/live_test.ts` (Bonus 13), 6 in `tests/purge_test.ts` (Bonus 14, one for Bonus 12),
6 in `tests/ratelimit_test.ts` (Bonus 15) and 4 in `tests/cache_test.ts` (Bonus 16). They
cover everything the handout lists: duplicate email (409), wrong password (401), missing
token (401), bad body (400), another user's task (404 for read, update **and** delete),
invalid status (400) and pagination (page 2 holds the right task), plus filtering, bad
query values, the 101-character title, an impossible due date, update and delete, and the
404 shape. `tests/helpers.ts` has `send()`, `login()` and `makeTask()`.

The tests really catch mistakes: with the owner condition removed from `own()` on purpose,
"another user's task is 404 for read, update and delete" fails (at that time 18 passed and
1 failed of 19), and with it back all pass.

## API with curl (R8)

These were recorded for the required part, before Bonus 2. Since Bonus 2 a new user also
gets a welcome task (so ids and totals are one higher) and every task has a `deletedAt`
field; the Bonus 2 section has a newer run.

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
$ curl -s -w '\n%{http_code}' localhost:8011/api/tasks/1 -H "Authorization: Bearer $TOKEN"
{"id":1,"userId":1,"title":"Calculus homework","status":"todo","priority":"high","dueDate":"2026-11-20","createdAt":1794857514}
200

$ curl -s -w '\n%{http_code}' localhost:8011/api/tasks/1 -H "Authorization: Bearer $MERY"
{"error":"task not found","issues":[]}
404
```

### PUT /api/tasks/:id

```
$ curl -s -w '\n%{http_code}' -X PUT localhost:8011/api/tasks/1 -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Calculus homework","status":"done","priority":"high","dueDate":"2026-11-20"}'
{"id":1,"userId":1,"title":"Calculus homework","status":"done","priority":"high","dueDate":"2026-11-20","createdAt":1794857514}
200

$ curl -s -w '\n%{http_code}' -X PUT localhost:8011/api/tasks/1 -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"Calculus homework","dueDate":"2026-02-30"}'
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
`expires_at` (one hour), or if the row is deleted. (Since Bonus 7 the token is a JWT: it
survives a restart too, but for another reason: it is checked with the secret, not looked
up at all.)

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

- Bonus 1: Migrations with Drizzle Kit
- Bonus 2: Soft delete, restore and a transaction
- Bonus 3: Joins and the N+1 problem
- Bonus 4: Indexes and EXPLAIN
- Bonus 5: Seed data
- Bonus 6: A connection pool (option B: my own pool on SQLite)
- Bonus 7: JWT instead of sessions
- Bonus 8: OpenAPI and a docs page
- Bonus 9: Roles (RBAC)
- Bonus 10: Logging and request ids
- Bonus 11: Health, readiness and configuration
- Bonus 12: File upload
- Bonus 13: WebSocket live updates
- Bonus 14: A background job with Deno.cron
- Bonus 15: Rate limit on login
- Bonus 16: A cache with Deno KV
- Bonus 18: Continuous integration
- Bonus 20: Git repository

## Bonus 1: Migrations with Drizzle Kit

Bonus 1: Migrations with Drizzle Kit

The hand-written `CREATE TABLE IF NOT EXISTS` statements in `migrate()` are gone. The
tables are now described only in `src/schema.ts`; Drizzle Kit writes the SQL from it into
`drizzle/`, and `migrate()` in `src/db.ts` runs those files with
`migrate(db, { migrationsFolder })` from `drizzle-orm/libsql/migrator`. Drizzle keeps a
table `__drizzle_migrations`, so every file runs once.

- `drizzle.config.ts` (from the handout), and two tasks: `deno task db:generate` writes a
  new migration after a change in `schema.ts`, `deno task db:migrate` applies them to
  `tasks.db` (the server also does it when it starts).
- **Before generating I had to move the CHECKs.** My old SQL had
  `CHECK (status IN (...))`, `CHECK (priority IN (...))` and `CHECK (role IN (...))`. They
  were only in that SQL, not in `schema.ts`, so a generated migration would have quietly
  lost them. They are now `check(...)` lines in `schema.ts`, and the first migration
  contains all three.
- `migrate()` finds `drizzle/` from its own file (`import.meta.url`), not from the current
  folder, so the tests and scripts work from anywhere (on Windows the URL path starts with
  `/C:/`, so the first slash is removed).
- Drizzle Kit writes its JSON files without a newline at the end, which `deno fmt --check`
  (and so the CI of Bonus 18) refuses. They are generated files, so I did not reformat
  them: `drizzle/` is in `fmt.exclude` in `deno.json`.

**The first migration.** `deno task db:generate` on my laptop:

```
C:\Users\eesma\Desktop\assignment5\assignment5>deno task db:generate
Task db:generate deno run -A npm:drizzle-kit@^0.31 generate
No config path provided, using default 'drizzle.config.ts'
Reading config file 'C:\Users\eesma\Desktop\assignment5\assignment5\drizzle.config.ts'
2 tables
tasks 10 columns 1 indexes 1 fks
users 5 columns 1 indexes 0 fks

[✓] Your SQL migration file ➜ drizzle\0000_tired_northstar.sql 🚀
```

`drizzle/0000_tired_northstar.sql` has the two `CREATE TABLE` statements (with the foreign
key and the three CHECKs), the index of Bonus 4 and the unique index on the email. Then
`deno task test` passed all 97 tests, which now build every test database from this file.

**How I made the second change.** The change is a column that tells when a task was last
changed. I added one nullable column to `tasks` in `schema.ts`,
`updatedAt: integer("updated_at")`, and set it to the current time in every route that
changes a task (PUT, DELETE, restore and the image upload). `createdAt` stays as it is; a
task that was never changed has `null`. Then I ran `deno task db:generate` again. Drizzle
Kit compared `schema.ts` with the snapshot of the first migration
(`drizzle/meta/0000_snapshot.json`) and wrote only the difference:

```
C:\Users\eesma\Desktop\assignment5\assignment5>deno task db:generate
...
tasks 11 columns 1 indexes 1 fks
users 5 columns 1 indexes 0 fks

[✓] Your SQL migration file ➜ drizzle\0001_messy_energizer.sql 🚀
```

`drizzle/0001_messy_energizer.sql` is one line:

```sql
ALTER TABLE `tasks` ADD `updated_at` integer;
```

This is the real fix for the problem in Bonus 2 and Bonus 9, where an old `tasks.db` had
to be deleted because `CREATE TABLE IF NOT EXISTS` never adds a column: a database made
with the first migration only gets the `ALTER TABLE`, and its rows stay. (A `tasks.db`
from before Bonus 1 has no `__drizzle_migrations` table, so Drizzle would try to create
its tables again; that one still has to be deleted once.) The column is also in the `Task`
schema of the OpenAPI document (Bonus 8): because the responses are typed,
`deno task check` would have failed if I had forgotten it there.

Tests (`tests/migrations_test.ts`, 5 tests): `drizzle/` has exactly two `.sql` files, the
first with both `CREATE TABLE`s and the second exactly the `ALTER TABLE` above; calling
`migrate()` twice runs each file once (`__drizzle_migrations` has 2 rows); an **old
database** made with a copy of `drizzle/` that knows only the first file gets the new
column from `migrate()` and keeps its task (with `updated_at` `null`); the database still
refuses `status = 'later'` with `CHECK constraint failed`; and a new task has
`updatedAt: null` until a PUT sets it.

## Bonus 2: Soft delete, restore and a transaction

Bonus 2: Soft delete, restore and a transaction

### Soft delete and restore

- `tasks` has a new nullable column `deleted_at` (`deletedAt` in `schema.ts`), in seconds
  like `created_at`. `null` means the task is visible.
- `DELETE /api/tasks/:id` no longer removes the row. It sets `deleted_at` to now with a
  SQL expression (`strftime('%s','now')`), only for a task that is mine and not deleted
  yet.
- Every list and lookup adds `isNull(tasks.deletedAt)`: it is inside `own()`, which GET,
  PUT and DELETE use, and inside the `where` of the list and its `count()`. So a deleted
  task is not listed, not counted in `total`, cannot be read or changed, and deleting it
  twice is 404.
- `POST /api/tasks/:id/restore` sets `deleted_at` back to `null`, but only when the task
  is mine **and** deleted (`isNotNull`). A task that is not deleted, not mine, or does not
  exist is 404 `deleted task not found`, the same "as if it did not exist" rule as R4.

Why soft delete: an accidental delete can be undone, and the history stays in the
database. The cost: every query must remember the extra condition (that is why it is in
one place, `own()`), and deleted rows still take space; a clean-up job (Bonus 14) would be
the place to remove them for real after some time.

**Existing databases:** `CREATE TABLE IF NOT EXISTS` does not add a column to a table that
already exists, so an old `tasks.db` must be deleted once (the handout's troubleshooting
says the same). Migrations (Bonus 1) are the real fix for this, and I did them later: the
`updated_at` column of Bonus 1 came as an `ALTER TABLE`.

### Register in one transaction

Registering now creates the user **and** a first task "Welcome! Add your first task"
(priority `low`) inside `db.transaction(async (tx) => { ... })`, using `tx` for both
inserts. If the second insert throws, the first one is rolled back, so there is never a
user without the welcome task.

To prove the rollback, `createApp(db, { welcomeTask })` can take another welcome task. The
test gives one with `priority: "urgent"`, which breaks the `CHECK (priority IN (...))` of
the table, so the second insert fails: the answer is 500 in the normal error shape, the
`users` table is still empty, and the same email can register afterwards (201).

Real run on an empty database (bash, `TOKEN` from a login):

```
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"id":1,"email":"esma@example.com","createdAt":1794947818}

$ curl -s localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN"
{"items":[{"id":1,"userId":1,"title":"Welcome! Add your first task","status":"todo","priority":"low","dueDate":null,"createdAt":1794947818,"deletedAt":null}],"page":1,"limit":20,"total":1}

$ curl -s -X POST localhost:8000/api/tasks -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"OOP lab 05","priority":"high"}'
{"id":2,"userId":1,"title":"OOP lab 05","status":"todo","priority":"high","dueDate":null,"createdAt":1794947819,"deletedAt":null}

$ curl -s -w '\n%{http_code}' -X DELETE localhost:8000/api/tasks/2 -H "Authorization: Bearer $TOKEN"
{"ok":true}
200

$ curl -s localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN"
{"items":[{"id":1,"userId":1,"title":"Welcome! Add your first task","status":"todo","priority":"low","dueDate":null,"createdAt":1794947818,"deletedAt":null}],"page":1,"limit":20,"total":1}

$ curl -s -w '\n%{http_code}' -X POST localhost:8000/api/tasks/2/restore -H "Authorization: Bearer $TOKEN"
{"id":2,"userId":1,"title":"OOP lab 05","status":"todo","priority":"high","dueDate":null,"createdAt":1794947819,"deletedAt":null}
200

$ curl -s -w '\n%{http_code}' -X POST localhost:8000/api/tasks/2/restore -H "Authorization: Bearer $TOKEN"
{"error":"deleted task not found","issues":[]}
404
```

Tests (`tests/softdelete_test.ts`, 5 tests): register creates the welcome task; a deleted
task is not listed, GET/PUT/DELETE are 404, but the row is still in the database with a
`deletedAt` time; restore brings the task back with its title, priority and due date;
restore is 404 for a task that is not deleted, not mine, or missing; and the rolled-back
registration. Three older tests now expect the welcome task (the list, the pagination
page, and the seed test's real user).

## Bonus 3: Joins and the N+1 problem

Bonus 3: Joins and the N+1 problem

`GET /api/me/summary` answers how many of my tasks are in each status (deleted tasks left
out), with every status present even when it is 0:

```
$ curl -s localhost:8000/api/me/summary -H "Authorization: Bearer $TOKEN"
{"todo":1,"in-progress":1,"done":2,"total":4}
```

`src/summary.ts` has the same function twice:

- **`summaryNaive` (N+1):** one query for the ids of my tasks, then **one more query per
  task** to read its status, and the counting happens in JavaScript.
- **`summaryGrouped`:** **one** query, `SELECT status, count(*) ... GROUP BY status`; the
  database counts and sends back at most three rows. The route uses this one.

`deno task n1` (`scripts/n1.ts`) fills a temporary database with 10, 100 and 1000 tasks,
runs both versions with a Drizzle logger that counts every query, and checks that both
give the same answer. Real output on my computer (Windows):

```
10 tasks: naive 11 queries (2.5 ms), grouped 1 query (0.5 ms), same answer: true
  naive, first 3 queries:
    select "id" from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)
    select "status" from "tasks" where "tasks"."id" = ?
    select "status" from "tasks" where "tasks"."id" = ?
  grouped:
    select "status", count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null) group by "tasks"."status"
  answer: {"todo":4,"in-progress":3,"done":3,"total":10}
100 tasks: naive 101 queries (11.1 ms), grouped 1 query (0.2 ms), same answer: true
1000 tasks: naive 1001 queries (93.3 ms), grouped 1 query (0.5 ms), same answer: true
```

**Why the first one grows with the data and the second does not:** the naive version sends
1 + N queries for N tasks, so 10 times more tasks means 10 times more queries; each query
is a round trip to the database with its own parsing and planning, and here it went from
2.5 ms to 93 ms. The grouped version sends one query whatever N is; the database still
reads the rows, but inside one query, and only three numbers come back. With a database on
another machine (Postgres, Turso) each extra query also costs a network round trip, so the
difference would be much bigger than on a local SQLite file.

Tests (`tests/summary_test.ts`, 4 tests): the counts per status (with the welcome task);
deleted tasks and other users' tasks are left out; no token is 401; and the naive and the
grouped version give the same answer.

## Bonus 4: Indexes and EXPLAIN

Bonus 4: Indexes and EXPLAIN

Every task query in the API starts with `WHERE user_id = ?`, and the list often adds
`AND status = ?`. So the index is on both columns, in that order:

- `schema.ts`: `index("idx_tasks_user_status").on(t.userId, t.status)`
- `migrate()` (before Bonus 1):
  `CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status)`; since
  Bonus 1 Drizzle Kit writes it into the first migration from the line above

`deno task explain` (`scripts/explain.ts`) fills a temporary database with **20 users and
20,000 tasks** (in batches of 500 rows), drops the index, and measures the query
`SELECT * FROM tasks WHERE user_id = ? AND status = ?` (and the same condition with
`count(*)`) 200 times each; then it creates the index and measures again. Real output on
my computer (Windows):

```
filled: 20 users, 20000 tasks
query: SELECT * FROM tasks WHERE user_id = ? AND status = ?   args: [7,"done"]
rows found: 333
before: SCAN tasks
before: SELECT * 3.000 ms, count(*) 0.931 ms (average of 200)
after:  SEARCH tasks USING INDEX idx_tasks_user_status (user_id=? AND status=?)
after:  SELECT * 2.113 ms, count(*) 0.031 ms (average of 200)
faster: SELECT * 1.4x, count(*) 30.0x
database file: 804 KiB without the index, 1128 KiB with it
```

What the two plans say:

- **Before: `SCAN tasks`**: SQLite reads all 20,000 rows and keeps the 333 that match.
- **After: `SEARCH tasks USING INDEX idx_tasks_user_status (user_id=? AND status=?)`**: it
  jumps in the index straight to the entries for user 7 with status `done`.

What the numbers show: the search itself became about **30 times faster** (`count(*)`:
0.931 ms → 0.031 ms), but `SELECT *` only went from 3.000 ms to 2.113 ms (1.4 times). With
the index, finding the 333 rows is almost free, and most of the remaining time is reading
the whole rows and sending all their columns back to JavaScript. So an index helps most
when a query returns few rows out of many (one user's page of 20, a count, a lookup), and
less when it returns many rows anyway.

**What an index costs:** the file grew from 804 KiB to 1128 KiB (+40%) because the index
is a second, sorted copy of the two columns; and every `INSERT`, `UPDATE` of `status` and
`DELETE` must update the index too, so writes get a little slower.

Tests (`tests/index_test.ts`, 2 tests): `migrate()` creates the index on
`(user_id, status)`, and `EXPLAIN QUERY PLAN` for the shape of the list query and of its
`count()` says `USING INDEX idx_tasks_user_status`.

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

## Bonus 6: A connection pool (Postgres or SQLite)

Bonus 6: A connection pool (Postgres or SQLite)

**I did option B**: a pool I wrote myself, on SQLite (`src/pool.ts`, used in `src/db.ts`
and `src/app.ts`).

- **`Pool<T>`** holds a fixed set of items. `acquire()` gives an idle one, or waits in a
  queue (first come, first served); `release()` hands the item straight to the next
  waiter, or puts it back; `use(fn)` borrows, runs `fn` and gives the item back in a
  `finally`, so a job that throws cannot keep it. Two changes to the example in the
  handout: `acquire()` checks `idle.length` instead of `if (item)` (an item could be `0`
  or `""`), and a waiter gives up after 5 s with a `PoolTimeoutError` instead of waiting
  for ever.
- **`createDbPool(url, size)`** opens `size` libSQL clients on the same file, each with
  its own Drizzle. `PRAGMA journal_mode = WAL` is set once (readers do not block the
  writer, and it is stored in the file, so every client gets it).
  `PRAGMA busy_timeout = 5000` is set **every time a client is lent out**, because I found
  that it does not stay: it belongs to one connection, and libSQL opens a new connection
  after a transaction. A small test printed `busy_timeout 5000` before a transaction and
  `busy_timeout 0` after it, while `journal_mode` stayed `wal`.
- **Every route borrows a client** through `withDb((db) => ...)` in `createApp`, and gives
  it back when its queries are done; the list route runs its two queries (page and total)
  on the same borrowed client. The purge job (Bonus 14) borrows one too. Without a pool
  (as in most tests) the app makes a pool of one around the database it was given, so the
  code is the same either way.

**Pool size: 4** (`POOL_SIZE`, 1 to 32 in `config.ts`). SQLite lets only one connection
write at a time, so more clients do not make writes faster; a few clients are enough for
reads to go on while one request is in a transaction. With a remote database (Turso, Bonus
19) every query is a network call, and then the number is a real limit on how many open at
once; 4 is small enough not to overload a free plan.

**When all clients are busy**, a request waits in the queue and gets the next client that
is released. If none comes back within 5 s, the app answers **503**
`database busy, try again` with `Retry-After: 1`, instead of piling up requests that hang.

**Why SQLite gains little from a pool** (compared with Postgres): Postgres is a separate
server, each connection is a process there, and a query waits for the network, so a pool
saves the cost of opening connections and lets many queries run at the same time. SQLite
is a file opened inside my process: opening a client is cheap, and only one writer can
work at a time anyway. I could see this in a test: 30 parallel creates through a pool of 3
passed **even with `busy_timeout = 0`**, because the local libSQL client runs each query
synchronously on Deno's one thread, so inside one process two queries never overlap. The
timeout matters when **another process** holds the lock (a second server,
`deno task seed`, the `sqlite3` tool). Real run with two processes (bash):
`scripts/lock/hold.ts` keeps a write transaction open for 2 s, and `scripts/lock/write.ts`
tries to insert one second later, first without and then with a busy timeout:

```
$ deno run -A scripts/lock/hold.ts & sleep 1; deno run -A scripts/lock/write.ts 0
holder: write lock taken, keeping it for 2 s
writer (busy_timeout=0): SQLITE_BUSY: database is locked
holder: committed
$ deno run -A scripts/lock/hold.ts & sleep 1; deno run -A scripts/lock/write.ts 5000
holder: write lock taken, keeping it for 2 s
holder: committed
writer (busy_timeout=5000): ok after 1033 ms
```

Real run of the API (bash, `POOL_SIZE=4`, `PORT=8016`, one registered user): 50 creates at
the same time, all 201, and the total is 51 with the welcome task:

```
$ seq 1 50 | xargs -P 50 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8016/api/tasks -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"title":"parallel {}"}' | sort | uniq -c
     50 201
$ curl -s "localhost:8016/api/tasks?limit=1" -H "authorization: Bearer $TOKEN"
{"items":[{"id":1,"userId":1,"title":"Welcome! Add your first task","status":"todo","priority":"low","dueDate":null,"createdAt":1795116762,"deletedAt":null,"doneAt":null,"attachment":null}],"page":1,"limit":1,"total":51}
```

Tests (`tests/pool_test.ts`, 6 tests): 20 jobs on a pool of 3 never run more than 3 at
once and all 20 finish; `release` serves the waiters in the order they came; `use` gives
the item back when the job throws; a waiter gives up after the timeout and leaves the
queue; the app answers 503 with `Retry-After` while somebody holds the only client, and
200 again after it is released; and a real pool of 3 clients on one file is in WAL mode
and takes 30 parallel creates without an error.

## Bonus 7: JWT instead of sessions

Bonus 7: JWT instead of sessions

`src/jwt.ts` uses `jose` (`"jose": "npm:jose@^6"` in `deno.json`):

- `signToken({ userId, role }, secret)` makes a JWT signed with HS256 (HMAC-SHA-256): the
  user id in `sub`, the role in a `role` claim (for Bonus 9), `iat`, and `exp` one hour
  later.
- `verifyToken(token, secret)` returns `{ userId, role }`, or `null` for a malformed,
  tampered or expired token, or one signed with another secret. It accepts only `HS256`.

Login now answers `{ token: await signToken(...) }` and writes nothing to the database.
`requireAuth(secret)` calls `verifyToken` instead of looking a session up, and sets
`userId` and `role` from the token. The given `sessions` table, `createSession` and
`userIdFromToken` were removed. Every route and every test of the required part kept
working unchanged, because they only use "log in, then send `Authorization: Bearer ...`".

The secret is `config.JWT_SECRET` (Bonus 11): `main.ts` passes it to `createApp`, and in
production the config refuses to start with the default `change-me` or with fewer than 32
characters.

Real run (bash). The middle part of the token is only base64, not encrypted: anybody can
read it, nobody can change it without the secret. Changing the last five characters of the
signature gives 401:

```
$ curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"token":"eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoidXNlciIsInN1YiI6IjEiLCJpYXQiOjE3OTQ5OTYxMzcsImV4cCI6MTc5NDk5OTczN30.1EFv_VFt9i_HqwVOVcunuFsXJWliKTZpPV9B9vglSaI"}

$ echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null; echo
{"role":"user","sub":"1","iat":1794996137,"exp":1794999737}

$ curl -s -w '\n%{http_code}' localhost:8000/api/me/summary -H "Authorization: Bearer $TOKEN"
{"todo":1,"in-progress":0,"done":0,"total":1}
200

$ curl -s -w '\n%{http_code}' localhost:8000/api/me/summary -H "Authorization: Bearer ${TOKEN%?????}xxxxx"
{"error":"unauthorized","issues":[]}
401
```

**Sessions against JWT:**

|                            | Session row (before)                                       | JWT (now)                                                                                                                      |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Who calls?                 | look the token up in the `sessions` table on every request | check the signature with the secret: **no database lookup**                                                                    |
| Several servers            | all of them need the same database to find the session     | any server with the secret can check it                                                                                        |
| Log out / block a user now | delete the row: the token stops working at once            | **not possible** before `exp`; it stays valid up to one hour (unless every server keeps a block list, which is a lookup again) |
| A role change (Bonus 9)    | can be read fresh on every request                         | is in the token, so it counts only after the next login (at most one hour)                                                     |
| What is in the token       | a random id, means nothing outside the database            | the user id and role, readable by anybody (no secrets in a JWT)                                                                |
| If the secret leaks        | nothing (no secret)                                        | anybody can make a token for any user, so the secret must be long and never in Git                                             |

So a JWT saves a lookup per request and works across servers, and it costs the ability to
take a login back. A short lifetime (one hour here) limits that cost.

Tests (`tests/jwt_test.ts`, 7 tests): login returns a JWT with `sub`, `role` and exactly
one hour to live; a token made directly with the secret reaches a route (only the
signature counts); a **tampered** token (one character of the signature changed) is 401; a
changed payload (`"role": "admin"` with the old signature) is 401 on the admin route; an
**expired** token is 401; a token signed with **another secret** is 401; and `verifyToken`
returns `null` for a tampered token, garbage and an empty string.

## Bonus 8: OpenAPI and a docs page

Bonus 8: OpenAPI and a docs page

`GET /openapi.json` is the OpenAPI 3.0 document of the whole API, and `GET /docs` is a
Swagger UI page that loads it (`@hono/swagger-ui`).

- **One set of schemas.** The app is now an `OpenAPIHono` (`@hono/zod-openapi`). Every
  route is described once in `src/openapi.ts` with `createRoute` (method, path, request
  body, query and path parameters, and every response) and registered in `src/app.ts` with
  `app.openapi(route, handler)`. The request schemas (`Credentials`, `TaskBody`,
  `ListQuery`, `TaskIdParam`) are the same Zod objects as before: they validate the
  request **and** become the document, so the docs cannot say `maxLength: 100` while the
  code allows 200. The handlers read `c.req.valid("json")`, `c.req.valid("query")` and
  `c.req.valid("param")` instead of calling `safeParse` themselves.
- **The same error shape as before.** A `defaultHook` turns a failed validation into
  `{ error: "validation failed", issues }` (400). A bad `{id}` in the path
  (`/api/tasks/abc`) is still **404** like an id that is not mine, not 400: each `{id}`
  route has its own hook that answers 404 for a failed `param`. A body that is not JSON at
  all is 400 (the validator throws, `onError` answers in our shape). One change: a body
  with another content-type (`text/plain`) is now **415** instead of 400, because the
  validator refuses it before Zod sees it; 415 is also the more exact code.
- **Bearer security scheme.** `registerComponent("securitySchemes", "Bearer", ...)` with
  `bearerFormat: "JWT"`, and every `/api/...` route has `security: [{ Bearer: [] }]`, so
  the docs page has an **Authorize** button and sends the token on those routes only.
- **Every response is listed**, not only the success: each route lists the error codes it
  can really return: 400 where it reads a body or a query, 401 on every `/api` route, 403
  on the admin route, 404 on every `{id}` route, 409, 413, 415 and 429 where they happen,
  and a `default` (500, or 503 when the pool of Bonus 6 is busy) on all of them. I did not
  add a 404 to routes that cannot return one (like `GET /api/tasks`), so the document does
  not promise something the code never does.
- **Typed answers.** Because the responses are declared, TypeScript checks that a handler
  only returns what its route declares: `deno task check` fails if, for example, the
  create route returns a body that is not a `Task`.
- The upload route documents a `multipart/form-data` body with a `file` field, so the docs
  page shows a file picker; the image itself is still checked in the route (Bonus 12). The
  download route documents `image/png` and `image/jpeg`. `/ws` (Bonus 13) is documented
  with its 101, 400 and 401.

Real run (bash, `PORT=8018`): every path with its documented response codes, the security
scheme, the `TaskBody` schema as the docs page gets it, and the docs page:

```
$ curl -s localhost:8018/openapi.json | jq -r '.paths | to_entries[] | .key as $p | .value | to_entries[] | "\(.key | ascii_upcase) \($p)  \(.value.responses | keys | join(" "))"'
GET /health  200 default
GET /healthz  200 default
GET /readyz  200 503 default
POST /auth/register  201 400 409 default
POST /auth/login  200 400 401 429 default
GET /ws  101 400 401 default
GET /api/admin/users  200 401 403 default
GET /api/me/summary  200 401 default
GET /api/tasks  200 400 401 default
POST /api/tasks  201 400 401 default
GET /api/tasks/{id}  200 401 404 default
PUT /api/tasks/{id}  200 400 401 404 default
DELETE /api/tasks/{id}  200 401 404 default
POST /api/tasks/{id}/restore  200 401 404 default
POST /api/tasks/{id}/attachment  201 400 401 404 413 415 default
GET /api/tasks/{id}/attachment  200 401 404 default
$ curl -s localhost:8018/openapi.json | jq -c .components.securitySchemes
{"Bearer":{"type":"http","scheme":"bearer","bearerFormat":"JWT"}}
$ curl -s localhost:8018/openapi.json | jq -c .components.schemas.TaskBody
{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100,"example":"Read Meteoroloji unit 7"},"status":{"type":"string","enum":["todo","in-progress","done"],"default":"todo"},"priority":{"type":"string","enum":["low","medium","high"],"default":"medium"},"dueDate":{"type":"string","nullable":true,"format":"date","default":null,"example":"2026-11-30"}},"required":["title"]}
$ curl -si localhost:8018/docs | head -1
HTTP/1.1 200 OK
```

**Trying it from the docs page** (`deno task seed`, `deno task dev`, then
http://localhost:8000/docs): I logged in with **POST /auth/login** ("Try it out" with the
demo user), copied the token into **Authorize**, and ran **GET /api/tasks**. The page sent
`Authorization: Bearer ...` by itself and got **200** with the demo tasks
([screenshot](docs/bonus8-swagger-try.png); the token in it was signed with the
development secret and expired after one hour).

Tests (`tests/openapi_test.ts`, 6 tests): `/openapi.json` lists exactly the 16 routes of
`routes` (method and path); the Bearer scheme exists and exactly the `/api` routes need
it; every `/api` route lists 401, every `{id}` route 404, every route with input 400, and
all of them `default`; the documented `TaskBody` has `maxLength: 100` and the three
statuses, and a 101-character title is refused with 400 at `["title"]`; `/docs` is the
Swagger UI page and loads `/openapi.json`; and a broken JSON body is 400 and a
`text/plain` body 415, both in our error shape. All 91 tests from before still pass
unchanged, which is how I know the move to `OpenAPIHono` did not change the API.

## Bonus 9: Roles (RBAC)

Bonus 9: Roles (RBAC)

- `users` has a `role` column: `user` (the default) or `admin`, with a `CHECK` in the SQL
  and `{ enum: ["user", "admin"] }` in `schema.ts`. An old `tasks.db` must be deleted
  once, because `CREATE TABLE IF NOT EXISTS` does not add the column to an existing table.
- `requireAuth` stores the role next to the user id (`c.set("role", ...)`). At first it
  read the role from the `users` table on every request; since Bonus 7 the role is a claim
  in the signed token, so no lookup is needed (the price: a role change counts after the
  next login, see the table in Bonus 7).
- `requireRole(...roles)` is a second middleware: **401** when nobody is logged in,
  **403** when somebody is logged in but their role is not in the list. It guards
  everything under `/api/admin/`.
- `GET /api/admin/users` lists every user with the number of their tasks (deleted tasks
  not counted), with one `LEFT JOIN` + `GROUP BY`, so a user with no tasks would still be
  listed with 0. The password hash is never selected.

**How an admin comes to exist:** with the `ADMIN_EMAIL` setting (checked as an email by
`config.ts`). Whoever registers with that email (in any letter case) gets the role
`admin`; everybody else gets `user`. The role can never come from the request body: `role`
is not in the Zod schema of register, so it is dropped. Without `ADMIN_EMAIL` there is no
admin at all, which is the safe default. To try it, start with
`ADMIN_EMAIL=hoca@example.com deno task dev` (or put `ADMIN_EMAIL=...` in `.env`).

**401 against 403:** 401 _Unauthorized_ really means "unauthenticated": I don't know who
you are (no token, or a bad or expired one), so log in and try again. 403 _Forbidden_
means "I know exactly who you are, and you may not do this": logging in again would not
help. So the order matters: first `requireAuth` decides who you are (401), then
`requireRole` decides what you may do (403).

Real run (bash), started with `ADMIN_EMAIL=hoca@example.com`:

```
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"hoca@example.com","password":"kediler123"}'
{"id":1,"email":"hoca@example.com","role":"admin","createdAt":1794995747}

$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"esma@example.com","password":"kediler123"}'
{"id":2,"email":"esma@example.com","role":"user","createdAt":1794995747}

$ curl -s -w '\n%{http_code}' localhost:8000/api/admin/users
{"error":"unauthorized","issues":[]}
401

$ curl -s -w '\n%{http_code}' localhost:8000/api/admin/users -H "Authorization: Bearer $TOKEN"
{"error":"forbidden","issues":[]}
403

$ curl -s -w '\n%{http_code}' localhost:8000/api/admin/users -H "Authorization: Bearer $ADMIN"
{"items":[{"id":1,"email":"hoca@example.com","role":"admin","createdAt":1794995747,"tasks":1},{"id":2,"email":"esma@example.com","role":"user","createdAt":1794995747,"tasks":1}]}
200
```

Tests (`tests/roles_test.ts`, 6 tests): no token is 401; a normal user is 403; the admin
gets every user with their number of tasks and no password hash; register gives `admin`
only to `ADMIN_EMAIL` (in any letter case); `"role": "admin"` in the body is ignored;
without `ADMIN_EMAIL` nobody is an admin.

## Bonus 10: Logging and request ids

Bonus 10: Logging and request ids

The first middleware in `createApp` gives every request a new id with
`crypto.randomUUID()`, runs the rest of the app, then:

- sets the **`x-request-id`** response header,
- writes **one JSON line** to the log: `{ time, requestId, method, path, status, ms }`.

A **404 and a 500** body also carries the id (`"requestId": "..."`), the same one as in
the header and in the log line. So when a user reports an error, the id in their error
message leads straight to the right line in the log.

`createApp(db, { log })` takes the function that writes the line (default `console.log`).
The tests give it an array to read the lines, and `freshApp()` gives an empty function so
that the test output stays readable.

A 404 with its id (bash):

```
$ curl -si localhost:8000/nothing-here
HTTP/1.1 404 Not Found
content-type: application/json
x-request-id: 95b8ebba-50dd-45e0-b91c-fc5eb97c8b14
content-length: 84
date: Wed, 18 Nov 2026 09:55:47 GMT

{"error":"not found","issues":[],"requestId":"95b8ebba-50dd-45e0-b91c-fc5eb97c8b14"}
```

The server log of the run above (the Bonus 9 requests and this 404), one line per request;
the last line has the same id as the 404:

```
{"time":"2026-11-18T09:55:47.507Z","requestId":"f7e81ed9-c4cf-4e05-afde-1d0cbaf47cff","method":"POST","path":"/auth/register","status":201,"ms":78}
{"time":"2026-11-18T09:55:47.585Z","requestId":"e3da8fcb-1b89-4cb9-afa7-859419d4b41c","method":"POST","path":"/auth/register","status":201,"ms":72}
{"time":"2026-11-18T09:55:47.659Z","requestId":"8140b9cb-3fc3-4e4c-bfa4-faeb8fce95d8","method":"POST","path":"/auth/login","status":200,"ms":67}
{"time":"2026-11-18T09:55:47.736Z","requestId":"59a637dd-98ce-4841-8106-b6e76746cdc5","method":"POST","path":"/auth/login","status":200,"ms":67}
{"time":"2026-11-18T09:55:47.745Z","requestId":"4baee80d-4eb0-498c-b819-5c6aa12ba9f5","method":"GET","path":"/api/admin/users","status":401,"ms":1}
{"time":"2026-11-18T09:55:47.751Z","requestId":"41e1f5b3-fad2-43ee-9929-504db65c7b85","method":"GET","path":"/api/admin/users","status":403,"ms":1}
{"time":"2026-11-18T09:55:47.757Z","requestId":"8d9ff80f-daee-439e-a918-44b2fe2e9c58","method":"GET","path":"/api/admin/users","status":200,"ms":1}
{"time":"2026-11-18T09:55:47.762Z","requestId":"95b8ebba-50dd-45e0-b91c-fc5eb97c8b14","method":"GET","path":"/nothing-here","status":404,"ms":0}
```

**No password or token in the log, and how I checked:** the middleware logs only six
fields that it builds itself: never the body (where the password is), never a header
(where the token is), and only `c.req.path`, which has no query string. The test "no log
line contains a password or a token" registers, logs in, makes an authenticated request
with a query string, and makes a failed login, then checks that none of the log lines
contains the password, the wrong password, the token or the query string. The log above
was also read by eye: it has paths, statuses and times only.

Tests (`tests/logging_test.ts`, 3 tests): every response has an `x-request-id` that is a
UUID and different each time; exactly one JSON line per request, with the same id as the
header and exactly the six fields; no password, token or query string in any line. Two
older tests now also check that the id in a 404 and a 500 body is the same as the header.

## Bonus 11: Health, readiness and configuration

Bonus 11: Health, readiness and configuration

### Two health routes

| Route          | Answers                                               | Meaning for a platform                                                                        |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /healthz` | always 200 `{ "ok": true }`                           | **liveness**: the process is up. If this fails, restart it.                                   |
| `GET /readyz`  | 200 `{ "ready": true }`, or 503 when `SELECT 1` fails | **readiness**: it can do real work. If this fails, send it no traffic, but do not restart it. |

`/healthz` does not touch the database on purpose: if the database is down, restarting the
API would not help, so liveness must stay green while readiness goes red. Both are outside
`/api`, so they need no token. The 503 uses the same error shape as every other failure.

```
$ curl -s localhost:8001/healthz
{"ok":true}
$ curl -s localhost:8001/readyz
{"ready":true}
```

### One validated configuration

`src/config.ts` reads `APP_ENV`, `PORT`, `DATABASE_URL` and `JWT_SECRET` **once**, checks
them with a Zod schema and returns one typed `config` object. `src/main.ts` uses only that
object; there is no `Deno.env.get` anywhere else. A wrong value stops the server at
start-up with a message that names every bad setting, instead of failing later in the
middle of a request.

- `APP_ENV` is `development`, `test` or `production` (default `development`).
- `PORT` is a whole number from 1 to 65535 (default 8000); `"8001"` from the file becomes
  `8001`.
- `DATABASE_URL` must start with `file:`, `libsql:` or `http(s):` (default
  `file:./tasks.db`).
- In **production**, `JWT_SECRET` may not be a development value (`change-me`,
  `dev-secret`, or empty, which means the default) and must have at least 32 characters.
- `ADMIN_EMAIL` (optional, Bonus 9) must be an email address.
- An empty value in a `.env` file counts as "not set", so the default applies.

`loadConfig(env)` takes the environment as a plain object, so the tests can pass any
values without changing the real environment.

### Environment files

- `.env.test`: `APP_ENV=test`, port 8001, its own `tasks-test.db`. No secrets, so it is in
  Git. Start with `deno task start:test`.
- `.env.production.example`: the template. Copy it to `.env.production` and fill in a real
  secret; `.env.production` is in `.gitignore`, so the secret never reaches Git. Start
  with `deno task start:prod`.

Real runs (bash):

```
$ deno task start:test
Task start:test deno run -A --env-file=.env.test src/main.ts
APP_ENV=test, database file:./tasks-test.db

$ deno task start:prod      # .env.production copied from the example, JWT_SECRET still empty
Task start:prod deno run -A --env-file=.env.production src/main.ts
invalid configuration:
  JWT_SECRET: the default development secret is not allowed in production

$ PORT=eighty APP_ENV=staging deno task start
Task start deno run -A src/main.ts
invalid configuration:
  APP_ENV: Invalid option: expected one of "development"|"test"|"production"
  PORT: Invalid input: expected number, received NaN
```

The example production file has an empty `JWT_SECRET`, so the default `change-me` applies,
and the server refuses to start, which is exactly the point: nobody can start production
by accident with a known secret.

Tests (`tests/config_test.ts`, 7 tests): `/healthz` is 200 without a token; `/readyz` is
200 with a working database; `/readyz` is 503 after the database client is closed while
`/healthz` stays 200; the development defaults; values are converted (`"9001"` → `9001`);
a bad `PORT`, `APP_ENV` and `DATABASE_URL` are all named in one error; production refuses
the default secret, a missing secret and a short one, and accepts 32 characters.

## Bonus 12: File upload

Bonus 12: File upload

A task can have one image (PNG or JPEG, at most 1 MB): `POST /api/tasks/:id/attachment`
uploads it as the form field `file`, `GET /api/tasks/:id/attachment` downloads it.

- **A nullable column `attachment`** holds the saved file name, or `null`.
- **The order of the checks:** the task must be mine (404, and nothing is saved for
  another user's task); then `c.req.parseBody()["file"]` must be a `File` (400, also for a
  text field called `file`); at most 1 MB (413); `image/png` or `image/jpeg` (415).
- **The type is checked twice.** The content-type of an upload is only what the client
  says: `curl -F "file=@notes.txt;type=image/png"` sends a text file as `image/png`. So
  the first bytes must also be the PNG signature (`89 50 4E 47 0D 0A 1A 0A`) or the JPEG
  one (`FF D8 FF`), otherwise 415 (`src/upload.ts`).
- **The body limit comes before `parseBody()`.** `parseBody()` reads the whole upload into
  memory, so a 100 MB body would be read before the 1 MB check could refuse it. Hono's
  `bodyLimit` middleware stops a body over 2 MB first (with the same 413); 2 MB because
  the multipart wrapping adds a few bytes around a 1 MB file. The exact 1 MB is checked on
  the file.
- **Saved under a generated name**, `crypto.randomUUID()` plus `.png` or `.jpg`, with
  `Deno.writeFile` in `UPLOAD_DIR` (default `./uploads`, a setting in `config.ts`). The
  user's file name is never used on the disk: it could be `../../src/app.ts`, or the same
  as another user's file. `uploads/` is in `.gitignore` and not in the zip.
- **Download:** only through the owner query, so another user gets 404, and so does a
  soft-deleted task. The content-type comes from the saved extension, with
  `x-content-type-options: nosniff` so the browser does not guess another type.
- **No files left behind:** a new image replaces the old file, and the purge job (Bonus
  14) deletes the images of the tasks it removes. A soft delete keeps the file, because
  the task can be restored.
- **The cache (Bonus 16)** is cleared after an upload, because the row changed.

Real run (bash; a server with `PORT=8012` and `UPLOAD_DIR=/tmp/b12/uploads`, and
`pixel.png` a real 1×1 PNG of 69 bytes). On Windows the same works with `curl.exe -F`:

```
$ curl -s -X POST localhost:8012/auth/register -H "content-type: application/json" -d '{"email":"esma@example.com","password":"kediler123"}'
{"id":1,"email":"esma@example.com","role":"user","createdAt":1794998693}
$ TOKEN=... (login as before)
$ curl -s -X POST localhost:8012/api/tasks/1/attachment -H "authorization: Bearer $TOKEN" -F file=@pixel.png
{"id":1,"userId":1,"title":"Welcome! Add your first task","status":"todo","priority":"low","dueDate":null,"createdAt":1794998693,"deletedAt":null,"doneAt":null,"attachment":"5a2ed839-b6c1-4c8a-8dfc-a754c87ca4bd.png"}
$ ls uploads
5a2ed839-b6c1-4c8a-8dfc-a754c87ca4bd.png
$ curl -s localhost:8012/api/tasks/1/attachment -H "authorization: Bearer $TOKEN" -D - -o back.png
HTTP/1.1 200 OK
content-type: image/png
x-content-type-options: nosniff
content-length: 69
$ cmp pixel.png back.png && echo same bytes
same bytes
$ curl -s -X POST localhost:8012/api/tasks/1/attachment -H "authorization: Bearer $TOKEN" -F file=@notes.txt
{"error":"only image/png or image/jpeg","issues":[]} -> 415
$ curl -s -X POST localhost:8012/api/tasks/1/attachment -H "authorization: Bearer $TOKEN" -F "file=@notes.txt;type=image/png"
{"error":"the file is not really image/png","issues":[]} -> 415
$ curl -s -X POST localhost:8012/api/tasks/1/attachment -H "authorization: Bearer $TOKEN" -F file=@big.png
{"error":"file too large (at most 1 MB)","issues":[]} -> 413
$ curl -s -X POST localhost:8012/api/tasks/1/attachment -H "authorization: Bearer $TOKEN" -F file=hello
{"error":"file required","issues":[{"path":["file"],"message":"send the image as the form field \"file\""}]} -> 400
```

Tests (`tests/upload_test.ts`, 8 tests, with `FormData` and
`new File([...], "a.png",
{ type: "image/png" })`, each app saving into its own temporary
folder): upload and download give back the same bytes with `image/png`, and the file on
disk has a UUID name, not `a.png`; a JPEG is saved as `.jpg`; an empty form and a text
field are 400; a file of 1 000 001 bytes is 413, and a 3 MB body is 413 from `bodyLimit`;
`text/plain` is 415, and a text file sent as `image/png` is 415; another user gets 404 for
upload and download and nothing is saved; a second upload leaves only the new file; and a
deleted task's image is 404. One more test in `tests/purge_test.ts` checks that the purge
deletes the image of a removed task and keeps the others. In all failure tests the folder
stays empty.

## Bonus 13: WebSocket live updates

Bonus 13: WebSocket live updates

A tab that has the task list open sees a change made in another tab at once.

- **`GET /ws?token=...`.** A browser cannot set an `Authorization` header on a WebSocket,
  so the token (the JWT of Bonus 7) comes in the query. It is checked with the same
  `verifyToken` as `requireAuth`, **before** `Deno.upgradeWebSocket`: a missing or bad
  token is 401 and never gets a socket. A request without `upgrade: websocket` is 400.
- **The token is not logged.** The request log of Bonus 10 writes only the path, never the
  query, so the line is `"path":"/ws","status":101` without the token (see the server log
  below). A token in a URL can still end up in a proxy log, which is why it is
  short-lived.
- **`LiveHub` (`src/live.ts`)** keeps a `Map<number, Set<WebSocket>>`: user id to that
  user's sockets, one per tab. `onopen` adds the socket, `onclose` removes it, and a user
  whose last tab closed is removed from the map.
- **After a create, update, delete, restore or upload** the route sends `{ type, task }`
  to the owner's sockets only (`live.send(userId, ...)`), never to everyone. A delete
  sends only `{ id }`. A change that fails (another user's task, 404) sends nothing.
- **The given UI** (two changes of mine): `App.tsx` opens the socket after login, loads
  the list again on every message and closes the socket on log out; `vite.config.ts`
  forwards `/ws` to the API with `ws: true`.
- **What it does not do:** a socket stays open after its token expires (the token is only
  checked when it connects), and the purge job (Bonus 14) sends no events. With several
  servers each one would only know its own sockets; they would need something shared (for
  example a `BroadcastChannel` on Deno Deploy).

Real run (bash): the API on `PORT=8013` after the seed, and `scripts/watch.ts`
(`deno task watch <email> <password>`) started three times: twice for Esma (two "tabs")
and once for Mery. Then three changes with curl as Esma, and a wrong token:

```
$ curl -s -X POST localhost:8013/api/tasks -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"title":"Bonus 13: WebSocket"}'
{"id":21,"userId":1,"title":"Bonus 13: WebSocket","status":"todo","priority":"medium","dueDate":null,"createdAt":1795115715,"deletedAt":null,"doneAt":null,"attachment":null}
$ curl -s -X PUT localhost:8013/api/tasks/21 -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"title":"Bonus 13: WebSocket","status":"done"}'
{"id":21,"userId":1,"title":"Bonus 13: WebSocket","status":"done","priority":"medium","dueDate":null,"createdAt":1795115715,"deletedAt":null,"doneAt":1795115715,"attachment":null}
$ curl -s -X DELETE localhost:8013/api/tasks/21 -H "authorization: Bearer $TOKEN"
{"ok":true}
$ curl -si "localhost:8013/ws?token=wrong" -H "upgrade: websocket" | head -1
HTTP/1.1 401 Unauthorized
```

What the three watchers printed:

```
# tab 1 (Esma)
demo.esma@example.com: connected, waiting for changes
demo.esma@example.com: created task 21 "Bonus 13: WebSocket" (todo)
demo.esma@example.com: updated task 21 "Bonus 13: WebSocket" (done)
demo.esma@example.com: deleted task 21
# tab 2 (Esma)
demo.esma@example.com: connected, waiting for changes
demo.esma@example.com: created task 21 "Bonus 13: WebSocket" (todo)
demo.esma@example.com: updated task 21 "Bonus 13: WebSocket" (done)
demo.esma@example.com: deleted task 21
# Mery
demo.mery@example.com: connected, waiting for changes
```

Both of Esma's sockets got all three changes; Mery's got nothing. The server log
(Bonus 10) for the four `/ws` requests: three upgrades (101) and the wrong token (401),
with no token in any line:

```
{"time":"2026-11-19T19:15:11.586Z","requestId":"69fadee6-89ea-455c-bafb-dc701e6bd6a3","method":"GET","path":"/ws","status":101,"ms":3}
{"time":"2026-11-19T19:15:11.589Z","requestId":"69373437-4d7d-41e3-a610-27697825cd3a","method":"GET","path":"/ws","status":101,"ms":0}
{"time":"2026-11-19T19:15:11.589Z","requestId":"f3b4fb76-44e2-458a-bc05-6f3de4d06973","method":"GET","path":"/ws","status":101,"ms":1}
{"time":"2026-11-19T19:15:15.410Z","requestId":"d84a118e-0f3c-4df3-b853-aa757406889f","method":"GET","path":"/ws","status":401,"ms":1}
```

**What I observed with the given UI** (`deno task seed`, `deno task dev`,
`deno task ui:dev`, then http://localhost:5173 in two tabs, both logged in as
`demo.esma@example.com`): I added a task, advanced one and deleted one in the first tab,
and each time the second tab changed too, at once, without reloading the page.

Tests (`tests/live_test.ts`, 4 tests): a missing, empty and wrong token are 401 before any
upgrade; a good token without an upgrade is 400; with the app on a real port, two sockets
of Esma both get `created`, `updated`, `deleted` and `restored` in that order while Mery's
socket gets nothing, and after closing all three the map is empty; a failed PUT on another
user's task sends nothing to anybody.

## Bonus 14: A background job with Deno.cron

Bonus 14: A background job with Deno.cron

Every night at 03:00 a job deletes the tasks that were done more than 30 days ago.

- **When was a task done?** The table had no answer, so tasks got a new column `done_at`
  (seconds). It is set when a task becomes `done` (on create or update) and set back to
  `null` when it is moved out of `done`. On an update it is
  `COALESCE(done_at, strftime('%s','now'))`, so saving a task that is already done (to
  rename it, for example) keeps the first time. `created_at` would be wrong here: a task
  made two months ago and finished yesterday must stay.
- **The work is a plain function**, `purgeOldDone(db, days)` in `src/purge.ts`: one
  `DELETE ... WHERE status = 'done' AND done_at IS NOT NULL AND done_at < now - days`. It
  takes the time as an option, so a test does not depend on today's date. It is a real
  DELETE, also for soft-deleted rows (Bonus 2): the job is there to free the space.
- **Idempotent:** a second run finds nothing older than the limit, because those rows are
  gone, and removes 0.
- **Registered in `main.ts`**, with the schedule from the config (Bonus 11), so I can make
  it run every minute without changing the code:

  ```ts
  Deno.cron("purge old done tasks", config.PURGE_CRON, async () => {
    const removed = await purgeOldDone(db, 30, { cache });
    console.log(
      JSON.stringify({ time: new Date().toISOString(), job: "purge", removed }),
    );
  });
  ```

  `PURGE_CRON` defaults to `0 3 * * *`, and the config refuses a value that does not have
  five fields. `--unstable-cron` is in the `dev`, `start`, `test` and `check` tasks.
- **The cache (Bonus 16)** is cleared for every removed task, or a GET could still answer
  with a purged task for up to a minute.
- **Seed (Bonus 5):** two of the demo tasks were done 40 and 45 days ago, so the job has
  something to remove.

Real run (PowerShell on my laptop): seed, then start with the job every minute. The first
run removed the two old demo tasks, the second one nothing:

```
PS> deno task seed
Task seed deno run -A scripts/seed.ts
seed: file:./tasks.db -> added 2 users and 20 tasks
seed: log in as demo.esma@example.com or demo.mery@example.com, password demo-password-1
PS> $env:PURGE_CRON="* * * * *"
PS> deno task start
Task start deno run -A --unstable-kv --unstable-cron src/main.ts
APP_ENV=development, database file:./tasks.db
Listening on http://localhost:8000/
{"time":"2026-11-18T10:38:00.027Z","job":"purge","removed":2}
{"time":"2026-11-18T10:39:00.009Z","job":"purge","removed":0}
```

Afterwards `Remove-Item Env:PURGE_CRON`, so the next start uses the nightly schedule
again.

Tests (`tests/purge_test.ts`, 5 tests): rows inserted directly with `done_at` 40, 31, 29
and 0 days ago, an old `todo` and a soft-deleted task done 50 days ago; the purge removes
exactly the three that are done and older than 30 days; a second run removes 0 and leaves
the same rows; `done_at` is set on create with `done`, cleared on a move to `in-progress`
and `null` for a `todo`; saving a done task again keeps its first `done_at`; and the purge
also removes the cached copy, so the next GET is 404. One more test in
`tests/config_test.ts` checks `PURGE_CRON`.

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

## Bonus 16: A cache with Deno KV

Bonus 16: A cache with Deno KV

`GET /api/tasks/:id` is answered from Deno KV for 60 seconds (`src/cache.ts`).

- **KV is opened once**, in `main.ts` (`Deno.openKv(config.KV_PATH)`), and given to
  `createApp` as a `TaskCache`. Without a cache (most tests) every read goes to the
  database as before. `--unstable-kv` is in the `dev`, `start`, `test` and `check` tasks.
- **The key is `["task", userId, taskId]`.** With the user id in the key, a request of
  another user looks under a different key and can never get this user's task, even if the
  ids are the same. A miss then goes to the database, where the owner check gives 404.
- **On a read:** a hit is returned at once; a miss loads the task with the owner query and
  stores it with `{ expireIn: 60_000 }`. A 404 is never cached. The answer has a header
  `x-cache: hit` or `x-cache: miss`, so a curl shows where it came from.
- **On a change:** `PUT`, `DELETE`, restore and the purge job (Bonus 14) call
  `kv.delete(key)`. The entry is deleted, not replaced, so the next GET loads the new row.
- **`expireIn` alone was not enough.** In a small test with `expireIn: 50`, `kv.get` still
  returned the value after 120 ms: Deno KV removes expired keys later, in the background.
  So every entry also stores its own end time (`until`), and `get` treats an old entry as
  a miss. The clock is a parameter (like the rate limiter in Bonus 15), so the test can
  move it 61 seconds forward without waiting.

Real run (bash, on a second database with `PORT=8011`, after the seed): the first GET is a
miss, the second a hit; after a PUT the next GET is a miss again and shows the new title:

```
$ curl -si localhost:8011/api/tasks/1 -H "authorization: Bearer $TOKEN"
HTTP/1.1 200 OK
x-cache: miss
{"id":1,"userId":1,"title":"Calculus homework 6","status":"todo","priority":"high","dueDate":"2026-11-24","createdAt":1794996884,"deletedAt":null,"doneAt":null}
$ curl -si localhost:8011/api/tasks/1 -H "authorization: Bearer $TOKEN"
HTTP/1.1 200 OK
x-cache: hit
{"id":1,"userId":1,"title":"Calculus homework 6","status":"todo","priority":"high","dueDate":"2026-11-24","createdAt":1794996884,"deletedAt":null,"doneAt":null}
$ curl -s -X PUT localhost:8011/api/tasks/1 -H "authorization: Bearer $TOKEN" \
    -H "content-type: application/json" \
    -d '{"title":"Calculus homework 6 (started)","priority":"high"}'
$ curl -si localhost:8011/api/tasks/1 -H "authorization: Bearer $TOKEN"
HTTP/1.1 200 OK
x-cache: miss
{"id":1,"userId":1,"title":"Calculus homework 6 (started)","status":"todo","priority":"high","dueDate":null,"createdAt":1794996884,"deletedAt":null,"doneAt":null}
```

(The PUT replaces the whole task, so the `dueDate` I did not send became `null`: the same
thing as in log entry 5.)

Tests (`tests/cache_test.ts`, 4 tests). A Drizzle logger counts the SELECTs on `tasks`:

- **hit:** the first GET reads the database once (`x-cache: miss`), the second reads it 0
  times (`x-cache: hit`) and gives the same body;
- **invalidation:** after a PUT the GET shows the new title and had to read the database;
  after a DELETE the GET is 404;
- **the key includes the user:** after Esma's GET, Mery's GET of the same id is 404, and
  KV holds the entry only under Esma's user id;
- **60 seconds:** with the test clock, a GET after 59 s is a hit and after 61 s a miss.

**What this cache does not do:** each server has its own KV file, so with two servers a
change on one would not clear the cache of the other (Deno Deploy shares one KV, a laptop
does not). The list `GET /api/tasks` is not cached at all, because one change would have
to clear many pages.

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
