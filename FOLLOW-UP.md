# FlexGraph: your follow-up checklist

FlexGraph is now open source (MIT) and published as `@kazant/flexgraph`. The earlier commercial version (license keys, license server, customer portal, pricing) is kept in the `commercial-archive` branch.

## 1. Release (one-time)

- [x] MIT license, `package.json` (name, author, repository, funding), README for npm
- [x] License check, license server and pricing removed from `main`
- [ ] GitHub repo public
- [ ] Published to npm (`npm login` as `kazant`, then `npm publish`)

## 2. Donations

- [ ] Apply for GitHub Sponsors at https://github.com/sponsors (Norway is supported; you need a Stripe account for payouts, and approval can take a few days). Until it is approved, the "Sponsor" links point to a page that is not live yet.
- [ ] Optional: add tiers (e.g. $5 / $25 / $100 per month) and a short profile text

The links are already in place: the Sponsor button on GitHub (`.github/FUNDING.yml`), `npm fund` (`funding` in `package.json`), the README badge and "Support" section, the docs page ("Support the project") and the showcase header and footer.

## 3. Publishing new versions

```bash
npm version patch      # or minor / major; updates package.json and creates a git tag
npm publish            # runs the tests and the build first (prepublishOnly)
git push --follow-tags
```

Update `CHANGELOG.md` before each release. Redeploy the site with `vercel deploy --prod` (or automatically once the GitHub repo is connected in Vercel).

## 4. Nice to have

- [ ] Connect the GitHub repo in Vercel (Project → Settings → Git) so every push redeploys the site
- [ ] GitHub Actions: run `npm test` on pull requests
- [ ] Speed up routing for 1000+ node graphs (the Web Worker option already keeps the UI responsive)
- [ ] Nested groups (only one level of groups is supported now)
- [ ] Network-simplex ranking for even more compact layouts
