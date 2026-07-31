export namespace main {
	
	export class BrewPackage {
	    name: string;
	    version: string;
	    description: string;
	    type: string;
	    outdated: boolean;
	    installed: boolean;
	    depends_on?: string[];
	    install_time?: string;
	
	    static createFrom(source: any = {}) {
	        return new BrewPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.outdated = source["outdated"];
	        this.installed = source["installed"];
	        this.depends_on = source["depends_on"];
	        this.install_time = source["install_time"];
	    }
	}
	export class BrewSearchResult {
	    name: string;
	    version: string;
	    description: string;
	    type: string;
	    installed: boolean;
	    score?: number;
	
	    static createFrom(source: any = {}) {
	        return new BrewSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.installed = source["installed"];
	        this.score = source["score"];
	    }
	}

}

