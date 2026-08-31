<?xml version="1.0" encoding="UTF-8"?>
<!--
  Build-time helper. Extracts the per-scenario customLevel severity overrides
  from a KoSIT validator scenarios.xml into a small lookup document:

    <overrides>
      <scenario name="EN16931 XRechnung (UBL Invoice)">
        <rule id="BR-CL-23" flag="warning"/>
        ...
      </scenario>
    </overrides>

  KoSIT levels map to SVRL flags: error -> fatal, warning -> warning,
  information -> information.
-->
<xsl:stylesheet version="3.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:s="http://www.xoev.de/de/validator/framework/1/scenarios"
                exclude-result-prefixes="s">

  <xsl:output method="xml" indent="yes"/>

  <xsl:template match="/">
    <overrides>
      <xsl:for-each select="//s:scenario">
        <scenario name="{s:name}">
          <xsl:for-each select=".//s:customLevel">
            <rule id="{normalize-space(.)}"
                  flag="{if (@level = 'error') then 'fatal' else @level}"/>
          </xsl:for-each>
        </scenario>
      </xsl:for-each>
    </overrides>
  </xsl:template>

</xsl:stylesheet>
