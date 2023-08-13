$PSInclude = Join-Path $PSScriptRoot "include/"
ls $PSInclude  *.ps1 | 
    %{
        $_.Name
        $path = $PSInclude  + $_.Name
        . $path
    }
