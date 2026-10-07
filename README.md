# My-the-cat 🐈‍⬛

By ehJimmy.

A pixel-art tuxedo cat with a red "MY" collar that lives just above your Claude Code prompt.

- **While Claude works**, it walks back and forth and now and then does something fun at a random spot: scratches its scratching block, does zoomies after its ball, or tilts its head and meows at its toy mouse.
- **When a task is done**, it does a victory stretch beside its star trophy, walks back to its corner and sits.
- **While you type**, it floats over the prompt with its paws tucked. A sleeping cat stretches awake first.
- **When you're idle**, it curls up and naps.
- **On the right**, it shows your usage: **Cat-text** (context window), **Play-session** (5-hour limit) and **Weekly**.

## Install

You need a recent Claude Code: version 2.1.289 or newer. Mods like this one are an early-access feature.

### From GitHub (gets updates)

This repository is private, so first ask ehJimmy to invite you, and accept the invite from your email or github.com/notifications. Your computer also needs to be signed in to GitHub for git (running `gh auth login` once does that).

Then in a terminal:

```bash
claude plugin marketplace add ehJimmy/my-the-cat
```

```bash
claude plugin install my-the-cat@my-the-cat
```

To get a newer version later: `claude plugin update my-the-cat@my-the-cat`.

### From the zip

1. **Unzip** the folder somewhere it can stay, for example `~/claude-mods/my-the-cat-marketplace`. Claude Code reads the cat from this folder, so don't delete or move it after installing.
2. **Add and install it:**

   ```bash
   claude plugin marketplace add ~/claude-mods/my-the-cat-marketplace
   ```

   ```bash
   claude plugin install my-the-cat@my-the-cat
   ```

### Then

**Start a new session.** In the desktop app, open a new Code chat and send a message; chats already open need a restart (quit and reopen the app). In the terminal, start `claude` again.

Only use the Claude desktop app? Start a Code chat and ask Claude to run the install commands for you.

## Good to know

- The cat looks best in the **Claude desktop app** (Code tab). In a terminal it shows as pixel art only in terminals that can draw images (Ghostty, kitty); elsewhere you'll see a small text cat and a one-line usage summary.
- The usage limits show only on a Claude subscription. With an API key you'll see just Cat-text.

## Uninstall

```bash
claude plugin uninstall my-the-cat@my-the-cat
```
