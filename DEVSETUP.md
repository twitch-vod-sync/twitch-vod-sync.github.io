setup steps:
- Clone the repo
- Download node v10 from https://nodejs.org/en/download/prebuilt-installer
- Run `npm install`
- Run `npm start`, then navigate to `localhost:3000`
- Click to redirect to Twitch, do auth, then you should be redirected back to the dev site.
- You should now be all set for development. Edit files, refresh the page, click buttons, repeat.

- Once you're ready, run `npm run check` to validate your code is warnings-free.
(you can also use `npm run fix` to automatically fix some errors)
This may return one of a few errors:
- Typescript warnings-as-errors (like using 'let' instead of 'const') -> These appear in red, with line numbers
- Linter errors (like spacing or line length) -> These appear in patch format, with + lines as the required change.

Once this comes up clean, you are ready to create a PR. Open your copy of the repo on GitHub,
  and there should be a "Contribute" button which will guide you through the PR process.
