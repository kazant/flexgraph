# FlexGraph: your follow-up checklist

FlexGraph is now open source (MIT) and published as `@kazant/flexgraph`. The earlier commercial version (license keys, license server, customer portal, pricing) is kept in the `commercial-archive` branch.

## 1. Release (one-time)

- [x] MIT license, `package.json` (name, author, repository, funding), README for npm
- [x] License check, license server and pricing removed from `main`
- [x] GitHub repo public: https://github.com/kazant/flexgraph
- [x] Published to npm: https://www.npmjs.com/package/@kazant/flexgraph (publishing needs 2FA; run `npm publish` in your own terminal so it can ask for the code)

## 2. Donations

- [x] Applied for GitHub Sponsors (2026-10-09): profile, Stripe payouts and tax form done; submitted for review
- [ ] Wait for the approval email from GitHub (usually a few days); until then the Sponsor links show a page that is not live yet
- [ ] Publish the sponsor tiers (4 drafts: $5, $25, $100 monthly and $10 one-time) at https://github.com/sponsors/kazant/dashboard/tiers; prices cannot be changed after publishing
- [ ] When someone sponsors at $25 or $100: add their name or logo to the README / website (a sponsors section)

The links are already in place: the Sponsor button on GitHub (`.github/FUNDING.yml`), `npm fund` (`funding` in `package.json`), the README badge and "Support" section, the docs page ("Support the project") and the showcase header and footer.

## 3. Publishing new versions

```bash
npm version patch      # or minor / major; updates package.json and creates a git tag
npm publish            # runs the tests and the build first; asks for your 2FA code
git push --follow-tags
```

Update `CHANGELOG.md` before each release. Redeploy the site with `vercel deploy --prod` (or automatically once the GitHub repo is connected in Vercel).

## 4. Nice to have

- [ ] Connect the GitHub repo in Vercel (Project → Settings → Git) so every push redeploys the site
- [ ] GitHub Actions: run `npm test` on pull requests
- [ ] Speed up routing for 1000+ node graphs (the Web Worker option already keeps the UI responsive)
- [ ] Nested groups (only one level of groups is supported now)
- [ ] Network-simplex ranking for even more compact layouts
