# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private vulnerability reporting
("Report a vulnerability" on the repository's Security tab) once the repository is public.

Include what you found, how to reproduce it, and which component is affected (sender, decoder page,
native app, protocol).

## Scope

In scope: anything that lets a crafted QR stream or file make a receiver write outside its save location,
run code, exhaust memory or disk (for example a decompression bomb), or accept a file whose checksum
doesn't match.

Out of scope: the fact that anyone who can see or film the sender's screen can read an unencrypted transfer.
That is how the channel works; use encryption (planned) for sensitive files.

## What the tool does not do

It makes no network connections and collects no telemetry. It does not hide transfers: anything shown
on screen is visible to whoever, or whatever, can see that screen.
