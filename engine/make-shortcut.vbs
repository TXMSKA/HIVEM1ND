' Writes one .lnk file. Arguments: the shortcut file, its target, its working folder, its icon, its description, then
' each argument the target receives, which this script quotes itself so that no quote has to cross a command line.
Option Explicit
Dim shell, link, index, joined
Set shell = CreateObject("WScript.Shell")
Set link = shell.CreateShortcut(WScript.Arguments(0))
link.TargetPath = WScript.Arguments(1)
link.WorkingDirectory = WScript.Arguments(2)
link.IconLocation = WScript.Arguments(3)
link.Description = WScript.Arguments(4)
joined = ""
For index = 5 To WScript.Arguments.Count - 1
  joined = joined & " """ & WScript.Arguments(index) & """"
Next
link.Arguments = Trim(joined)
link.WindowStyle = 7
link.Save
