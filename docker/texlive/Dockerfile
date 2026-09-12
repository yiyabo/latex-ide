# TeX Live slim image for sandboxed compilation
# Build: docker build -t latex-ide-texlive:latest -f docker/texlive/Dockerfile docker/texlive
FROM texlive/texlive:latest

# Non-root user
RUN useradd -m -u 1000 tex && mkdir -p /project /out && chown -R tex:tex /out

USER tex
WORKDIR /out

# No network tools intentionally installed
ENTRYPOINT ["latexmk"]
CMD ["--version"]
