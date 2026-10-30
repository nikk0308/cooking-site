# Disposable ACL acceptance image only, never a production runtime input.
ARG MEDIA_TEST_BASE
FROM ${MEDIA_TEST_BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends acl && rm -rf /var/lib/apt/lists/*
USER 10001:10001
CMD ["tail", "-f", "/dev/null"]
