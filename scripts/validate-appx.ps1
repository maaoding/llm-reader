param(
    [string] $OutputDirectory = 'release/store'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputPath = (Resolve-Path -LiteralPath $OutputDirectory).Path
$app = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$packageName = "LLM-Reader-$($app.version)-store-x64.appx"
$packagePath = Join-Path $outputPath $packageName
$namespace = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10'
$visualNamespace = 'http://schemas.microsoft.com/appx/manifest/uap/windows10'
$updatePattern = '(^|[/\\])(app-update\.ya?ml|latest[^/\\]*\.ya?ml|[^/\\]+\.blockmap)$'

function Assert-Value($Actual, $Expected, [string] $Field) {
    if ($Actual -cne $Expected) { throw "${Field}: expected '$Expected', got '$Actual'." }
}

function Get-AppxEntry([string] $Name) {
    $entry = $package.GetEntry($Name)
    if (!$entry -or $entry.Length -eq 0) { throw "Missing or empty AppX entry: $Name" }
    return $entry
}

function Assert-EntryHash([string] $EntryName, [string] $FilePath) {
    $stream = (Get-AppxEntry $EntryName).Open()
    try {
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream))
        Assert-Value $hash (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash $EntryName
    } finally { $stream.Dispose() }
}

$package = [IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $reader = [Xml.XmlReader]::Create((Get-AppxEntry 'AppxManifest.xml').Open(), [Xml.XmlReaderSettings]@{ CloseInput = $true })
    try {
        $manifest = [Xml.XmlDocument]::new()
        $manifest.Load($reader)
    } finally { $reader.Dispose() }
    $namespaces = [Xml.XmlNamespaceManager]::new($manifest.NameTable)
    $namespaces.AddNamespace('appx', $namespace)
    $namespaces.AddNamespace('uap', $visualNamespace)
    $identity = $manifest.SelectSingleNode('/appx:Package/appx:Identity', $namespaces)
    $properties = $manifest.SelectSingleNode('/appx:Package/appx:Properties', $namespaces)
    $application = $manifest.SelectSingleNode('/appx:Package/appx:Applications/appx:Application', $namespaces)
    Assert-Value $identity.GetAttribute('Name') '1C124951.LLMReader' 'Package identity'
    Assert-Value $identity.GetAttribute('Publisher') 'CN=9EF5245E-A210-44E8-AC98-8F1FC24678DD' 'Publisher'
    Assert-Value $identity.GetAttribute('Version') "$($app.version).0" 'AppX version'
    Assert-Value $identity.GetAttribute('ProcessorArchitecture') 'x64' 'Architecture'
    Assert-Value $properties.SelectSingleNode('appx:PublisherDisplayName', $namespaces).InnerText '马奥丁' 'Publisher display name'
    Assert-Value $application.GetAttribute('Id') 'LLMReader' 'Application ID'
    Assert-Value $application.GetAttribute('Executable') 'app\LLM Reader.exe' 'Executable'
    $null = Get-AppxEntry 'app/LLM%20Reader.exe'
    $null = Get-AppxEntry 'AppxBlockMap.xml'

    $visuals = $application.SelectSingleNode('uap:VisualElements', $namespaces)
    $tile = $visuals.SelectSingleNode('uap:DefaultTile', $namespaces)
    $logos = [ordered]@{
        StoreLogo = $properties.SelectSingleNode('appx:Logo', $namespaces).InnerText
        Square44x44Logo = $visuals.GetAttribute('Square44x44Logo')
        Square150x150Logo = $visuals.GetAttribute('Square150x150Logo')
        Wide310x150Logo = $tile.GetAttribute('Wide310x150Logo')
    }
    foreach ($logo in $logos.Keys) {
        Assert-Value $logos[$logo] "assets\$logo.png" "$logo manifest path"
        Assert-EntryHash "assets/$logo.png" (Join-Path $repo "resources/appx/$logo.png")
    }
    Assert-EntryHash 'app/resources/icon.ico' (Join-Path $repo 'resources/icon.ico')
    Assert-EntryHash 'app/resources/icon.png' (Join-Path $repo 'resources/icon.png')
    foreach ($license in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
        Assert-EntryHash "app/resources/$license" (Join-Path $repo $license)
    }
    Assert-EntryHash 'app/resources/app.asar' (Join-Path $outputPath 'win-unpacked/resources/app.asar')

    $archiveUpdateFiles = @($package.Entries | Where-Object { $_.FullName -match $updatePattern })
    $outputUpdateFiles = @(Get-ChildItem -LiteralPath $outputPath -File -Recurse | Where-Object { $_.Name -match $updatePattern })
    if ($archiveUpdateFiles.Count -or $outputUpdateFiles.Count) { throw 'Found legacy update metadata in the package or build output.' }

    $report = [ordered]@{
        passed = $true
        file = $packageName
        sha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
        identity = $identity.GetAttribute('Name')
        publisher = $identity.GetAttribute('Publisher')
        applicationId = $application.GetAttribute('Id')
        version = $identity.GetAttribute('Version')
        architecture = $identity.GetAttribute('ProcessorArchitecture')
        verifiedLogos = @($logos.Keys)
        applicationIconsMatch = $true
        licensesMatch = $true
        asarMatchesUnpackedBuild = $true
        legacyUpdateMetadataAbsent = $true
    }
    $json = $report | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath (Join-Path $outputPath 'appx-validation.json') -Value $json -Encoding utf8NoBOM
    $json
} finally { $package.Dispose() }
