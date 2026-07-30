export namespace main {
	
	export class BrewPackage {
	    name: string;
	    version: string;
	    description: string;
	    type: string;
	    outdated: boolean;
	
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
	    }
	}
	export class BrewSearchResult {
	    name: string;
	    version: string;
	    description: string;
	    type: string;
	    installed: boolean;
	
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
	    }
	}

}

