# Impala Local Library Helper

Small localhost service for pilot local-library playback.

Expected library shape:

```text
C:\Users\<you>\Music\
  Artist\
    Album\
      Track.mp3
```

Default address:

```text
http://127.0.0.1:8089
```

Build for Windows from a machine with Go installed:

```powershell
go build -o Impala-Helper.exe .
```

Suggested pilot install folder:

```text
C:\Users\<you>\Impala-Helper\
```

Run:

```powershell
.\Impala-Helper.exe
```

Optional custom port:

```powershell
$env:IMPALA_HELPER_ADDR="127.0.0.1:8090"
.\Impala-Helper.exe
```

Impala Settings should use the same port if a custom port is needed.
