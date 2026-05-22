---
agent: 'agent'
description: 'Genera los diagramas C4 para el sistema ATS usando PlantUML con la librería C4-PlantUML'
---

Necesito crear los diagramas C4 para el sistema ATS que estamos diseñando. Haz uso del lenguaje PlantUML y de la siguiente referencia para darme el código necesario.

Una vez generados los diagramas, crea o sobreescribe el archivo `docs/c4-diagrams.md` en la raíz del proyecto con el siguiente contenido:

1. **Resumen breve** (2-3 párrafos) describiendo los niveles C4 representados y las decisiones de diseño clave.
2. El **código PlantUML completo** de cada diagrama dentro de bloques de código individuales, con un encabezado que indique el nivel (Context, Container, Component, etc.).

La referencia de estructura a seguir es la siguiente:

```plantuml
@startuml "techtribesjs"
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
' uncomment the following line and comment the first to use locally
' !include C4_Container.puml

LAYOUT_TOP_DOWN()
'LAYOUT_AS_SKETCH()
LAYOUT_WITH_LEGEND()


Person_Ext(anonymous_user, "Anonymous User")
Person(aggregated_user, "Aggregated User")
Person(administration_user, "Administration User")

System_Boundary(c1, "techtribes.js"){

    Container(web_app, "Web Application", "Java, Spring MVC, Tomcat 7.x", "Allows users to view people, tribes, content, events, jobs, etc. from the local tech, digital and IT sector")

    ContainerDb(rel_db, "Relational Database", "MySQL 5.5.x", "Stores people, tribes, tribe membership, talks, events, jobs, badges, GitHub repos, etc.")

    Container(filesystem, "File System", "FAT32", "Stores search indexes")

    ContainerDb(nosql, "NoSQL Data Store", "MongoDB 2.2.x", "Stores from RSS/Atom feeds (blog posts) and tweets")

    Container(updater, "Updater", "Java 7 Console App", "Updates profiles, tweets, GitHub repos and content on a scheduled basis")
}

System_Ext(twitter, "Twitter")
System_Ext(github, "GitHub")
System_Ext(blogs, "Blogs")


Rel(anonymous_user, web_app, "Uses", "HTTPS")
Rel(aggregated_user, web_app, "Uses", "HTTPS")
Rel(administration_user, web_app, "Uses", "HTTPS")

Rel(web_app, rel_db, "Reads from and writes to", "SQL/JDBC, port 3306")
Rel(web_app, filesystem, "Reads from")
Rel(web_app, nosql, "Reads from", "MongoDB wire protocol, port 27017")

Rel_U(updater, rel_db, "Reads from and writes data to", "SQL/JDBC, port 3306")
Rel_U(updater, filesystem, "Writes to")
Rel_U(updater, nosql, "Reads from and writes to", "MongoDB wire protocol, port 27017")

Rel(updater, twitter, "Gets profile information and tweets from", "HTTPS")
Rel(updater, github, "Gets information about public code repositories from", "HTTPS")
Rel(updater, blogs, "Gets content using RSS and Atom feeds from", "HTTP")

Lay_R(rel_db, filesystem)

@enduml
```
