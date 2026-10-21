# OpenViCloud Cloud Console

The customer portal of OpenViCloud (`portal/`), built with React and Vite, in English and Vietnamese.

The API it calls is [OpenViCloud/control-plane](https://github.com/OpenViCloud/control-plane); the design docs live in
[OpenViCloud/titan](https://github.com/OpenViCloud/titan). Paths such as `docs/features/...` in code comments refer to
titan.

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
tagged with the commit's first 7 characters. Only the publishing job of a push to `main` may write packages; pull
requests run the tests only. Which tag an environment runs is decided
outside this repository: dev by `scripts/pull-images.py` of
[OpenViCloud/titan-local-cluster](https://github.com/OpenViCloud/titan-local-cluster), staging by a release of
[OpenViCloud/titan](https://github.com/OpenViCloud/titan).

## License

Proprietary: all rights reserved. No license is granted.
