# Dashboard example

The plugin deliberately does not run an HTTP server. Read the same SQLite queue with:

~~~bash
dsh-agent-lines --json list
~~~

Fields: label/title/role/lifecycle/generation/pending/unread/lastActivityAt/lease.
The Surface feedback dashboard (refresh-dashboard.js) can consume this JSON and keep its own directory scan.

For a handoff snapshot before replacing a line:

~~~text
line_handoff({ line: "writer", format: "json" })
~~~
