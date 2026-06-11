# Finding XML schema

Return:

```xml
<findings>
  <finding>
    <severity>critical|warning|suggestion</severity>
    <category>security|correctness|performance|tests-docs|release|agents-md|general</category>
    <file>path/to/file.ext</file>
    <line>123</line>
    <title>Short concrete title</title>
    <evidence>Specific source-based evidence.</evidence>
    <impact>Why this matters.</impact>
    <suggested_direction>Minimal fix direction, not a full patch.</suggested_direction>
  </finding>
</findings>
```

If there are no findings:

```xml
<findings />
```
