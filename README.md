# OpenViCloud Cloud Console

The customer portal of OpenViCloud (`portal/`), built with React and Vite, in English and Vietnamese.

The API it calls is [OpenViCloud/titan-control-plane](https://github.com/OpenViCloud/titan-control-plane); the design
docs live in [OpenViCloud/titan-ops](https://github.com/OpenViCloud/titan-ops). Paths such as `docs/features/...` in
code comments refer to titan-ops.

## Develop

Node 22.

```sh
(cd portal && npm install && npm run dev)
```

`npm run dev` needs a running OpenViCloud dev cluster: it sends `/v1` to `http://api.localhost:8080` and takes
`/config.json` from `http://portal.localhost:8080`. The cluster is set up by `mac/` in
[OpenViCloud/titan-local-cluster](https://github.com/OpenViCloud/titan-local-cluster).

## Test

```sh
(cd portal && npm run lint && npm test && npm run build)
```

## Image

Every push to `main` publishes the `linux/arm64` image `ghcr.io/openvicloud/titan-cloud-console` (`ci-portal.yml`),
tagged with the commit's first 7 characters. The image builds beside the tests, its layers kept in the Actions cache;
only the push job of a push to `main` may write packages, once the tests pass. Pull requests run the tests and build the
image without pushing it. Which tag an environment runs is decided outside this repository: dev by
`scripts/pull-images.py` of [OpenViCloud/titan-local-cluster](https://github.com/OpenViCloud/titan-local-cluster),
staging by a release of [OpenViCloud/titan-ops](https://github.com/OpenViCloud/titan-ops).

## License

Proprietary: all rights reserved. No license is granted.
